"""Profile endpoints."""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from .. import database as db
from ..common import PROFILE_FIELDS, audit, own_profile, public
from ..identity import Actor, actor, require
from ..schemas import ProfileInput, ProfileOutput

router = APIRouter(prefix="/api/v1")


@router.get("/profile")
def get_profile(current: Actor = Depends(actor), session: Session = Depends(db.get_db)):
    """Return the nurse's approved profile and opt-in status."""
    return public(own_profile(session, current), PROFILE_FIELDS)


@router.put("/profile")
def put_profile(body: ProfileInput, current: Actor = Depends(actor), session: Session = Depends(db.get_db)):
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
