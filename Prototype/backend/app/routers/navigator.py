"""Rule-based Navigator endpoint."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import database as db
from ..identity import Actor, actor
from ..schemas import ChatInput
from ..services.navigator import answer

router = APIRouter(prefix="/api/v1")


@router.post("/navigator/messages")
def navigator(body: ChatInput, current: Actor = Depends(actor), session: Session = Depends(db.get_db)):
    """Answer limited demo questions using fixed rules, not an AI model.

    A referenced result requires ownership and current opt-in. Unsupported
    questions suggest support; this endpoint never creates a support request.
    """
    return answer(session, current, body)
