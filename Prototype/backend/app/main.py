"""FastAPI endpoints for the synthetic-data GoNurse demonstration.

The demo uses client-selected identities and deterministic matching/chat rules.
Neither the identities nor the assistant are production authentication or AI.
Database models live in database.py; the React client calls the routes below.
"""

import logging
from contextlib import asynccontextmanager
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from . import database as db

# Fixed demo identities make role and ownership flows repeatable in tests.
# The client can select any identity, so these headers provide no real security.
NURSE = "00000000-0000-4000-8000-000000000001"
OTHER_NURSE = "00000000-0000-4000-8000-000000000002"
ADMIN = "00000000-0000-4000-8000-000000000003"
ACTORS = {"nurse": (NURSE, "nurse"), "nurse2": (OTHER_NURSE, "nurse"), "admin": (ADMIN, "admin")}
logger = logging.getLogger("gonurse")


class Input(BaseModel):
    """Reject unexpected fields and normalize text for all request bodies."""
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @field_validator("*", mode="after")
    @classmethod
    def reject_blank(cls, value):
        """Disallow whitespace-only text and blank entries in string arrays."""
        if isinstance(value, str) and not value.strip():
            raise ValueError("Text must not be blank.")
        if isinstance(value, list) and any(not item.strip() for item in value):
            raise ValueError("Array entries must not be blank.")
        return value


class ProfileInput(Input):
    """Editable matching fields and the explicit recommendation preference."""
    skills: list[str] = Field(max_length=100)
    interests: list[str] = Field(max_length=100)
    availability: list[str] = Field(max_length=100)
    recommendations_opt_in: bool


class OpportunityInput(Input):
    """Administrator-supplied listing, including eligibility and schedule."""
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=2000)
    category: Literal["project", "committee", "mentoring", "professional_development"]
    required_skills: list[str] = Field(max_length=100)
    interests: list[str] = Field(max_length=100)
    availability: list[str] = Field(max_length=100)
    status: Literal["open", "closed"]


class RecommendationInput(Input):
    """Limit the number of eligible ranked results returned to a nurse."""
    limit: int = Field(default=5, ge=1, le=20)


class FeedbackInput(Input):
    """Record a rating or decline without automatically changing ranking."""
    rating: Literal["helpful", "not_helpful", "declined"]
    comment: str | None = Field(default=None, max_length=2000)


class ChatInput(Input):
    """Identify a question and, optionally, the result it refers to."""
    message: str = Field(min_length=1, max_length=2000)
    recommendation_id: UUID | None = None


class SupportInput(Input):
    """Describe a nurse-initiated request for human help."""
    subject: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=2000)


class SupportUpdate(Input):
    """Represent an administrator's status change and optional response."""
    status: Literal["in_review", "closed"]
    response: str | None = Field(default=None, max_length=2000)


def audit(session, actor, event, resource):
    """Stage a minimal event in the same transaction as the triggering action."""
    session.add(db.AuditEvent(id=str(uuid4()), actor_id=actor[0], event=event, resource_id=resource))


def seed(session):
    """Insert two synthetic listings on a fresh prototype database."""
    if session.get(db.Opportunity, "10000000-0000-4000-8000-000000000001") is None:
        session.add_all([
            db.Opportunity(id="10000000-0000-4000-8000-000000000001", title="Nurse mentoring committee",
                description="Help develop a mentoring program.", category="committee",
                required_skills=["mentoring"], interests=["education"], availability=["weekday_morning"], status="open"),
            db.Opportunity(id="10000000-0000-4000-8000-000000000002", title="Pediatric education project",
                description="Create learning resources for nursing staff.", category="project",
                required_skills=["pediatric nursing"], interests=["education"], availability=[], status="open"),
        ])
        session.commit()


@asynccontextmanager
async def lifespan(_app):
    """Create prototype tables and seed data before accepting requests."""
    engine = db.get_engine()
    db.Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as session:
        seed(session)
    yield


# The local Vite development server is the only allowed browser origin.
app = FastAPI(title="GoNurse local prototype", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["GET", "POST", "PUT", "PATCH"], allow_headers=["Content-Type", "X-Demo-User"])


def error(status, code, message, details=None):
    """Return the common API error envelope with a new request identifier."""
    return JSONResponse(status_code=status, content={"error": {
        "code": code, "message": message, "details": details or [], "request_id": str(uuid4())}})


@app.exception_handler(HTTPException)
async def http_error(_request, exc):
    """Convert deliberate HTTP errors to the shared response format."""
    return error(exc.status_code, f"HTTP_{exc.status_code}", str(exc.detail))


@app.exception_handler(RequestValidationError)
async def validation_error(_request, exc):
    """Return invalid field locations without echoing submitted values."""
    details = [{"field": ".".join(str(x) for x in item["loc"]), "message": item["msg"]} for item in exc.errors()]
    return error(422, "VALIDATION_ERROR", "One or more fields are invalid.", details)


@app.exception_handler(Exception)
async def unexpected_error(_request, exc):
    """Log the exception type while keeping internal details out of responses."""
    logger.error("Request failed: %s", type(exc).__name__)
    return error(500, "INTERNAL_ERROR", "The request could not be completed.")


def actor(x_demo_user: Annotated[str | None, Header()] = None):
    """Resolve the selected demo identity; this is not authentication."""
    if x_demo_user not in ACTORS:
        raise HTTPException(401, "Select a demo user.")
    return ACTORS[x_demo_user]


def require(current, role):
    """Enforce a demo role on an operation."""
    if current[1] != role:
        raise HTTPException(403, "This operation is not permitted for this demo role.")


def public(obj, fields):
    """Select response fields so internal ownership fields are not exposed."""
    return {field: getattr(obj, field) for field in fields}


PROFILE_FIELDS = ("id", "skills", "interests", "availability", "recommendations_opt_in", "updated_at")
OPPORTUNITY_FIELDS = ("id", "title", "description", "category", "required_skills", "interests", "availability", "status", "updated_at")
SUPPORT_FIELDS = ("id", "subject", "description", "status", "response", "created_at", "updated_at")
NAVIGATOR_OPPORTUNITY_FIELDS = (
    "id", "title", "description", "category", "required_skills", "interests", "availability",
)


def own_profile(session, current):
    """Load the selected nurse's profile or report that it does not exist."""
    require(current, "nurse")
    profile = session.get(db.Profile, current[0])
    if profile is None:
        raise HTTPException(404, "Profile not found.")
    return profile


def owned_recommendation(session, current, recommendation_id):
    """Restrict a recommendation lookup to its nurse owner."""
    require(current, "nurse")
    rec = session.get(db.Recommendation, str(recommendation_id))
    if rec is None or rec.owner_id != current[0]:
        raise HTTPException(404, "Recommendation not found.")
    return rec


# Profile routes create or replace only the selected demo nurse's record.
@app.get("/api/v1/profile")
def get_profile(current=Depends(actor), session: Session = Depends(db.get_db)):
    """Return the nurse's approved profile and opt-in status."""
    return public(own_profile(session, current), PROFILE_FIELDS)


@app.put("/api/v1/profile")
def put_profile(body: ProfileInput, current=Depends(actor), session: Session = Depends(db.get_db)):
    """Create or replace the profile and audit the change."""
    require(current, "nurse")
    profile = session.get(db.Profile, current[0])
    created = profile is None
    if created:
        profile = db.Profile(id=current[0])
        session.add(profile)
    for key, value in body.model_dump().items():
        setattr(profile, key, value)
    profile.updated_at = db.now()
    audit(session, current, "profile.updated", profile.id)
    session.commit()
    return JSONResponse(status_code=201 if created else 200,
                        content=ProfileOutput.model_validate(profile).model_dump(mode="json"))


class ProfileOutput(BaseModel):
    """Serialize a saved ORM profile for the create/update response."""
    model_config = ConfigDict(from_attributes=True)
    id: str
    skills: list[str]
    interests: list[str]
    availability: list[str]
    recommendations_opt_in: bool
    updated_at: object


def visible_opportunities(session, current, limit, offset):
    """Fetch a page of opportunities visible to the selected demo role."""
    query = select(db.Opportunity).order_by(db.Opportunity.title, db.Opportunity.id)
    if current[1] == "nurse":
        query = query.where(db.Opportunity.status == "open")
    return session.scalars(query.offset(offset).limit(limit)).all()


def visible_opportunity(session, current, opportunity_id):
    """Fetch one visible opportunity without revealing closed listings to nurses."""
    item = session.get(db.Opportunity, str(opportunity_id))
    if item is None or (current[1] == "nurse" and item.status != "open"):
        raise HTTPException(404, "Opportunity not found.")
    return item


# Nurses browse open listings; administrators can manage all listing states.
@app.get("/api/v1/opportunities")
def list_opportunities(limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0),
                       current=Depends(actor), session: Session = Depends(db.get_db)):
    """Return a paginated, role-filtered list of opportunities."""
    items = visible_opportunities(session, current, limit, offset)
    return {"items": [public(item, OPPORTUNITY_FIELDS) for item in items], "limit": limit, "offset": offset}


@app.get("/api/v1/opportunities/{opportunity_id}")
def get_opportunity(opportunity_id: UUID, current=Depends(actor), session: Session = Depends(db.get_db)):
    """Return one visible opportunity, hiding closed listings from nurses."""
    item = visible_opportunity(session, current, opportunity_id)
    return public(item, OPPORTUNITY_FIELDS)


def build_navigator_context(session: Session, current: tuple[str, str],
                            recommendation_id: UUID | None = None) -> dict[str, object]:
    """Build a minimal, nurse-scoped context for a future Navigator service."""
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


@app.post("/api/v1/opportunities", status_code=201)
def create_opportunity(body: OpportunityInput, current=Depends(actor), session: Session = Depends(db.get_db)):
    """Create and audit an administrator-supplied listing."""
    require(current, "admin")
    item = db.Opportunity(id=str(uuid4()), updated_at=db.now(), **body.model_dump())
    session.add(item)
    audit(session, current, "opportunity.created", item.id)
    session.commit()
    return public(item, OPPORTUNITY_FIELDS)


@app.put("/api/v1/opportunities/{opportunity_id}")
def update_opportunity(opportunity_id: UUID, body: OpportunityInput, current=Depends(actor),
                       session: Session = Depends(db.get_db)):
    """Replace and audit an existing administrator-managed listing."""
    require(current, "admin")
    item = session.get(db.Opportunity, str(opportunity_id))
    if item is None:
        raise HTTPException(404, "Opportunity not found.")
    for key, value in body.model_dump().items():
        setattr(item, key, value)
    item.updated_at = db.now()
    audit(session, current, "opportunity.updated", item.id)
    session.commit()
    return public(item, OPPORTUNITY_FIELDS)


def normalized(values):
    """Normalize free-form skill and availability labels for exact comparison."""
    return {value.strip().casefold() for value in values}


def rank(profile, opportunities, limit):
    """Filter eligible listings, then deterministically rank and explain them.

    All required skills must match. A specified opportunity schedule needs at
    least one matching profile label; an empty schedule has no restriction.
    Score ties are ordered by title and ID to keep results repeatable.
    """
    ranked = []
    for item in opportunities:
        skills = normalized(profile.skills)
        if not normalized(item.required_skills).issubset(skills):
            continue
        if item.availability and not (normalized(profile.availability) & normalized(item.availability)):
            continue
        matching_skills = normalized(item.required_skills) & skills
        matching_interests = normalized(item.interests) & normalized(profile.interests)
        score = len(matching_skills) + len(matching_interests)
        explanation = f"Eligible; matched {len(matching_skills)} required skills and {len(matching_interests)} interests."
        ranked.append((score, item, explanation))
    ranked.sort(key=lambda result: (-result[0], result[1].title.casefold(), result[1].id))
    return ranked[:limit]


@app.post("/api/v1/recommendations")
def generate(body: RecommendationInput, current=Depends(actor), session: Session = Depends(db.get_db)):
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


@app.post("/api/v1/recommendations/{recommendation_id}/feedback", status_code=201)
def feedback(recommendation_id: UUID, body: FeedbackInput, current=Depends(actor), session: Session = Depends(db.get_db)):
    """Record feedback for an owned result without changing future rankings."""
    owned_recommendation(session, current, recommendation_id)
    entry = db.Feedback(id=str(uuid4()), owner_id=current[0], recommendation_id=str(recommendation_id),
                        rating=body.rating, comment=body.comment, created_at=db.now())
    session.add(entry)
    audit(session, current, "feedback.created", entry.id)
    session.commit()
    return public(entry, ("id", "recommendation_id", "rating", "comment", "created_at"))


@app.post("/api/v1/navigator/messages")
def navigator(body: ChatInput, current=Depends(actor), session: Session = Depends(db.get_db)):
    """Answer limited demo questions using fixed rules, not an AI model.

    A referenced result requires ownership and current opt-in. Unsupported
    questions suggest support; this endpoint never creates a support request.
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
        answer = "Use the profile form to update your skills, interests, availability, and recommendation preference."
        return {"answer": answer, "referenced_opportunity_ids": [], "escalation_suggested": False}
    if "opportunit" in text or "listing" in text:
        items = session.scalars(select(db.Opportunity).where(db.Opportunity.status == "open").order_by(db.Opportunity.title).limit(5)).all()
        answer = "Open opportunities: " + ", ".join(item.title for item in items) if items else "There are no open opportunities."
        return {"answer": answer, "referenced_opportunity_ids": [item.id for item in items], "escalation_suggested": False}
    return {"answer": "I cannot answer that in this demo. You can submit a support request.",
            "referenced_opportunity_ids": [], "escalation_suggested": True}


# Support requests are separate from chat: submission is an explicit action.
@app.post("/api/v1/support-requests", status_code=201)
def create_support(body: SupportInput, current=Depends(actor), session: Session = Depends(db.get_db)):
    """Create and audit a request owned by the selected nurse."""
    require(current, "nurse")
    entry = db.SupportRequest(id=str(uuid4()), owner_id=current[0], status="open",
                              created_at=db.now(), updated_at=db.now(), **body.model_dump())
    session.add(entry)
    audit(session, current, "support.created", entry.id)
    session.commit()
    return public(entry, SUPPORT_FIELDS)


@app.get("/api/v1/support-requests")
def list_support(status: Literal["open", "in_review", "closed"] | None = None,
                 limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0),
                 current=Depends(actor), session: Session = Depends(db.get_db)):
    """List a nurse's requests or, for administrators, all requests."""
    query = select(db.SupportRequest).order_by(db.SupportRequest.created_at.desc())
    if current[1] == "nurse":
        query = query.where(db.SupportRequest.owner_id == current[0])
    if status:
        query = query.where(db.SupportRequest.status == status)
    entries = session.scalars(query.offset(offset).limit(limit)).all()
    return {"items": [public(entry, SUPPORT_FIELDS) for entry in entries], "limit": limit, "offset": offset}


@app.get("/api/v1/support-requests/{request_id}")
def get_support(request_id: UUID, current=Depends(actor), session: Session = Depends(db.get_db)):
    """Return a request only to its owner or an administrator."""
    entry = session.get(db.SupportRequest, str(request_id))
    if entry is None or (current[1] != "admin" and entry.owner_id != current[0]):
        raise HTTPException(404, "Support request not found.")
    return public(entry, SUPPORT_FIELDS)


@app.patch("/api/v1/support-requests/{request_id}")
def update_support(request_id: UUID, body: SupportUpdate, current=Depends(actor), session: Session = Depends(db.get_db)):
    """Let an administrator review or close a request with a response."""
    require(current, "admin")
    entry = session.get(db.SupportRequest, str(request_id))
    if entry is None:
        raise HTTPException(404, "Support request not found.")
    if entry.status == "closed" or entry.status == body.status:
        raise HTTPException(409, "Invalid support request state transition.")
    if body.status == "closed" and not body.response:
        raise HTTPException(422, "A response is required to close a support request.")
    entry.status = body.status
    if body.response:
        entry.response = body.response
    entry.updated_at = db.now()
    audit(session, current, "support.updated", entry.id)
    session.commit()
    return public(entry, SUPPORT_FIELDS)
