"""Opportunity listing and administration endpoints."""

from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import database as db
from ..common import OPPORTUNITY_FIELDS, audit, public
from ..identity import Actor, actor, require
from ..schemas import OpportunityInput
from ..services.opportunities import visible_opportunities, visible_opportunity

router = APIRouter(prefix="/api/v1")


@router.get("/opportunities")
def list_opportunities(limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0),
                       current: Actor = Depends(actor), session: Session = Depends(db.get_db)):
    """Return a paginated, role-filtered list of opportunities."""
    items = visible_opportunities(session, current, limit, offset)
    return {"items": [public(item, OPPORTUNITY_FIELDS) for item in items], "limit": limit, "offset": offset}


@router.get("/opportunities/{opportunity_id}")
def get_opportunity(opportunity_id: UUID, current: Actor = Depends(actor),
                    session: Session = Depends(db.get_db)):
    """Return one visible opportunity, hiding closed listings from nurses."""
    item = visible_opportunity(session, current, opportunity_id)
    return public(item, OPPORTUNITY_FIELDS)


@router.post("/opportunities", status_code=201)
def create_opportunity(body: OpportunityInput, current: Actor = Depends(actor),
                       session: Session = Depends(db.get_db)):
    """Create and audit an administrator-supplied listing."""
    require(current, "admin")
    item = db.Opportunity(id=str(uuid4()), updated_at=db.now(), **body.model_dump())
    session.add(item)
    audit(session, current, "opportunity.created", item.id)
    session.commit()
    return public(item, OPPORTUNITY_FIELDS)


@router.put("/opportunities/{opportunity_id}")
def update_opportunity(opportunity_id: UUID, body: OpportunityInput, current: Actor = Depends(actor),
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
