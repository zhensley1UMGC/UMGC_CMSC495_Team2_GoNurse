"""Rule-based Navigator behavior for the local prototype."""

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import database as db
from ..common import own_profile, owned_recommendation, public
from ..identity import Actor, require
from ..schemas import ChatInput
from .opportunities import visible_opportunities, visible_opportunity

NAVIGATOR_OPPORTUNITY_FIELDS = (
    "id", "title", "description", "category", "required_skills", "interests", "availability",
)


def build_navigator_context(session: Session, current: Actor,
                            recommendation_id: UUID | None = None) -> dict[str, object]:
    """Build minimal, nurse-scoped context for the Navigator provider."""
    profile = own_profile(session, current)
    recommendation = None
    referenced_item = None
    if recommendation_id is not None:
        if not profile.recommendations_opt_in:
            raise HTTPException(403, "Recommendations are turned off.")
        rec = owned_recommendation(session, current, recommendation_id)
        referenced_item = visible_opportunity(session, current, rec.opportunity_snapshot["id"])
        recommendation = {
            "id": rec.id,
            "opportunity_at_generation": {
                field: rec.opportunity_snapshot[field] for field in NAVIGATOR_OPPORTUNITY_FIELDS
            },
            "rank": rec.rank,
            "explanation": rec.explanation,
        }

    items = list(visible_opportunities(session, current, 20, 0))
    if referenced_item is not None and all(item.id != referenced_item.id for item in items):
        items.append(referenced_item)
    return {
        "profile": public(profile, ("skills", "interests", "availability")),
        "current_opportunities": [public(item, NAVIGATOR_OPPORTUNITY_FIELDS) for item in items],
        "recommendation": recommendation,
    }


def answer(session: Session, current: Actor, body: ChatInput) -> dict[str, object]:
    """Answer limited demo questions using fixed rules, not an AI model.

    A referenced result requires ownership and current opt-in. Unsupported
    questions suggest support; this service never creates a support request.
    """
    require(current, "nurse")
    if body.recommendation_id:
        profile = own_profile(session, current)
        if not profile.recommendations_opt_in:
            raise HTTPException(403, "Recommendations are turned off.")
        rec = owned_recommendation(session, current, body.recommendation_id)
        return {"answer": rec.explanation, "referenced_opportunity_ids": [rec.opportunity_snapshot["id"]],
                "escalation_suggested": False}
    text = body.message.casefold()
    if "opt" in text or "profile" in text:
        answer_text = "Use the profile form to update your skills, interests, availability, and recommendation preference."
        return {"answer": answer_text, "referenced_opportunity_ids": [], "escalation_suggested": False}
    if "opportunit" in text or "listing" in text:
        items = session.scalars(select(db.Opportunity).where(db.Opportunity.status == "open")
                                .order_by(db.Opportunity.title).limit(5)).all()
        answer_text = "Open opportunities: " + ", ".join(item.title for item in items) if items else "There are no open opportunities."
        return {"answer": answer_text, "referenced_opportunity_ids": [item.id for item in items],
                "escalation_suggested": False}
    return {"answer": "I cannot answer that in this demo. You can submit a support request.",
            "referenced_opportunity_ids": [], "escalation_suggested": True}
