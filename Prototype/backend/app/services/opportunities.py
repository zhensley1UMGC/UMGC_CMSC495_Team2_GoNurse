"""Visibility rules for opportunity queries."""

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import database as db
from ..identity import Actor


def visible_opportunities(session: Session, current: Actor, limit: int, offset: int) -> list[db.Opportunity]:
    """Fetch a page of opportunities visible to the selected demo role."""
    query = select(db.Opportunity).order_by(db.Opportunity.title, db.Opportunity.id)
    if current[1] == "nurse":
        query = query.where(db.Opportunity.status == "open")
    return session.scalars(query.offset(offset).limit(limit)).all()


def visible_opportunity(session: Session, current: Actor, opportunity_id: UUID | str) -> db.Opportunity:
    """Fetch one visible opportunity without revealing closed listings to nurses."""
    item = session.get(db.Opportunity, str(opportunity_id))
    if item is None or (current[1] == "nurse" and item.status != "open"):
        raise HTTPException(404, "Opportunity not found.")
    return item
