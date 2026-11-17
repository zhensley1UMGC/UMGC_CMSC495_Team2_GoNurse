"""Nurse support request and administrator review endpoints."""

from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import database as db
from ..common import SUPPORT_FIELDS, audit, public
from ..identity import Actor, actor, require
from ..schemas import SupportInput, SupportUpdate

router = APIRouter(prefix="/api/v1")


@router.post("/support-requests", status_code=201)
def create_support(body: SupportInput, current: Actor = Depends(actor),
                   session: Session = Depends(db.get_db)):
    """Create and audit a request owned by the selected nurse."""
    require(current, "nurse")
    entry = db.SupportRequest(id=str(uuid4()), owner_id=current[0], status="open",
                              created_at=db.now(), updated_at=db.now(), **body.model_dump())
    session.add(entry)
    audit(session, current, "support.created", entry.id)
    session.commit()
    return public(entry, SUPPORT_FIELDS)


@router.get("/support-requests")
def list_support(status: Literal["open", "in_review", "closed"] | None = None,
                 limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0),
                 current: Actor = Depends(actor), session: Session = Depends(db.get_db)):
    """List a nurse's requests or, for administrators, all requests."""
    query = select(db.SupportRequest).order_by(db.SupportRequest.created_at.desc())
    if current[1] == "nurse":
        query = query.where(db.SupportRequest.owner_id == current[0])
    if status:
        query = query.where(db.SupportRequest.status == status)
    entries = session.scalars(query.offset(offset).limit(limit)).all()
    return {"items": [public(entry, SUPPORT_FIELDS) for entry in entries], "limit": limit, "offset": offset}


@router.get("/support-requests/{request_id}")
def get_support(request_id: UUID, current: Actor = Depends(actor), session: Session = Depends(db.get_db)):
    """Return a request only to its owner or an administrator."""
    entry = session.get(db.SupportRequest, str(request_id))
    if entry is None or (current[1] != "admin" and entry.owner_id != current[0]):
        raise HTTPException(404, "Support request not found.")
    return public(entry, SUPPORT_FIELDS)


@router.patch("/support-requests/{request_id}")
def update_support(request_id: UUID, body: SupportUpdate, current: Actor = Depends(actor),
                   session: Session = Depends(db.get_db)):
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
