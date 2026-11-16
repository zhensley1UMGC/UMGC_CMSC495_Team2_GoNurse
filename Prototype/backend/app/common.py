"""Shared persistence and response helpers used by API routers and services."""

from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session

from . import database as db
from .identity import Actor, require

PROFILE_FIELDS = ("id", "skills", "interests", "availability", "recommendations_opt_in", "updated_at")
OPPORTUNITY_FIELDS = (
    "id", "title", "description", "category", "required_skills", "interests", "availability", "status", "updated_at",
)
SUPPORT_FIELDS = ("id", "subject", "description", "status", "response", "created_at", "updated_at")


def audit(session: Session, current: Actor, event: str, resource: str) -> None:
    """Stage a minimal event in the same transaction as the triggering action."""
    session.add(db.AuditEvent(id=str(uuid4()), actor_id=current[0], event=event, resource_id=resource))


def public(obj, fields: tuple[str, ...]) -> dict[str, object]:
    """Select response fields so internal ownership fields are not exposed."""
    return {field: getattr(obj, field) for field in fields}


def own_profile(session: Session, current: Actor) -> db.Profile:
    """Load the selected nurse's profile or report that it does not exist."""
    require(current, "nurse")
    profile = session.get(db.Profile, current[0])
    if profile is None:
        raise HTTPException(404, "Profile not found.")
    return profile


def owned_recommendation(session: Session, current: Actor, recommendation_id: UUID) -> db.Recommendation:
    """Restrict a recommendation lookup to its nurse owner."""
    require(current, "nurse")
    rec = session.get(db.Recommendation, str(recommendation_id))
    if rec is None or rec.owner_id != current[0]:
        raise HTTPException(404, "Recommendation not found.")
    return rec
