"""Recommendation generation and feedback endpoints."""

from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import database as db
from ..common import OPPORTUNITY_FIELDS, audit, own_profile, owned_recommendation, public
from ..identity import Actor, actor
from ..schemas import FeedbackInput, RecommendationInput
from ..services.recommendations import rank

router = APIRouter(prefix="/api/v1")


@router.post("/recommendations")
def generate(body: RecommendationInput, current: Actor = Depends(actor),
             session: Session = Depends(db.get_db)):
    """Check opt-in, retrieve open listings, and persist the ranked result set."""
    profile = own_profile(session, current)
    if not profile.recommendations_opt_in:
        raise HTTPException(403, "Enable recommendations before generating results.")
    opportunities = session.scalars(select(db.Opportunity).where(db.Opportunity.status == "open")).all()
    generated_at = db.now()
    results = []
    # Save the result and audit event together; the engine itself only receives data.
    for position, (_, item, explanation) in enumerate(rank(profile, opportunities, body.limit), 1):
        snapshot = public(item, OPPORTUNITY_FIELDS)
        snapshot["updated_at"] = item.updated_at.isoformat()
        rec = db.Recommendation(id=str(uuid4()), owner_id=current[0], opportunity_snapshot=snapshot,
                                rank=position, explanation=explanation, generated_at=generated_at)
        session.add(rec)
        results.append({"id": rec.id, "opportunity": snapshot, "rank": position, "explanation": explanation})
    audit(session, current, "recommendations.generated", current[0])
    session.commit()
    return {"items": results, "generated_at": generated_at}


@router.post("/recommendations/{recommendation_id}/feedback", status_code=201)
def feedback(recommendation_id: UUID, body: FeedbackInput, current: Actor = Depends(actor),
             session: Session = Depends(db.get_db)):
    """Record feedback for an owned result without changing future rankings."""
    owned_recommendation(session, current, recommendation_id)
    entry = db.Feedback(id=str(uuid4()), owner_id=current[0], recommendation_id=str(recommendation_id),
                        rating=body.rating, comment=body.comment, created_at=db.now())
    session.add(entry)
    audit(session, current, "feedback.created", entry.id)
    session.commit()
    return public(entry, ("id", "recommendation_id", "rating", "comment", "created_at"))
