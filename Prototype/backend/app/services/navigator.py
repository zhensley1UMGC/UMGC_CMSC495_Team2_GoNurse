"""Scoped context and AI orchestration for the local Navigator prototype."""

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..common import own_profile, owned_recommendation, public
from ..identity import Actor
from ..schemas import ChatInput
from .ai_provider import NavigatorProvider, NavigatorResponse, ProviderInputError, ProviderResponseError
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
        "profile": public(profile, ("skills", "interests", "availability", "recommendations_opt_in")),
        "current_opportunities": [public(item, NAVIGATOR_OPPORTUNITY_FIELDS) for item in items],
        "recommendation": recommendation,
    }


def _validated_response(response: object) -> NavigatorResponse:
    """Revalidate provider output, including responses from injected implementations."""
    try:
        if isinstance(response, NavigatorResponse):
            response = response.model_dump(mode="json")
        return NavigatorResponse.model_validate(response)
    except (TypeError, ValueError):
        raise ProviderResponseError("The provider returned an invalid response.") from None


def answer(session: Session, current: Actor, body: ChatInput,
           provider: NavigatorProvider) -> dict[str, object]:
    """Ask the configured provider using scoped context and validate its citations."""
    profile = own_profile(session, current)
    if not profile.recommendations_opt_in and body.recommendation_id is None:
        return {
            "answer": (
                "Career Navigator is unavailable while recommendations are turned off. "
                "Update your recommendation preference to continue, or submit a human support request."
            ),
            "referenced_opportunity_ids": [],
            "escalation_suggested": True,
        }

    context = build_navigator_context(session, current, body.recommendation_id)
    result = _validated_response(provider.generate(body.message, context))

    try:
        opportunities = context["current_opportunities"]
        if not isinstance(opportunities, list):
            raise TypeError
        allowed_ids: set[UUID] = set()
        for item in opportunities:
            if not isinstance(item, dict) or not isinstance(item.get("id"), (str, UUID)):
                raise TypeError
            allowed_ids.add(UUID(item["id"]) if isinstance(item["id"], str) else item["id"])
    except (KeyError, TypeError, ValueError):
        raise ProviderInputError("The Navigator context could not be prepared.") from None
    referenced_ids = [UUID(value) for value in result.referenced_opportunity_ids]
    if any(opportunity_id not in allowed_ids for opportunity_id in referenced_ids):
        raise ProviderResponseError("The provider cited an opportunity outside the supplied context.")

    return {
        "answer": result.answer,
        "referenced_opportunity_ids": [str(opportunity_id) for opportunity_id in referenced_ids],
        "escalation_suggested": result.escalation_suggested,
    }
