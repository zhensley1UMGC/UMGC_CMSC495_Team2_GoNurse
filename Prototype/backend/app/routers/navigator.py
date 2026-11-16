"""AI-backed Navigator endpoint."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import database as db
from ..identity import Actor, actor, require
from ..schemas import ChatInput
from ..services.ai_provider import (
    NavigatorProvider,
    OpenAICompatibleProvider,
    ProviderConfigurationError,
    ProviderInputError,
    ProviderResponseError,
    ProviderTimeoutError,
    ProviderUpstreamError,
)
from ..services.navigator import answer

router = APIRouter(prefix="/api/v1")


def get_navigator_provider() -> NavigatorProvider:
    """Create the provider without reading configuration or making a request."""
    return OpenAICompatibleProvider()


@router.post("/navigator/messages")
def navigator(body: ChatInput, current: Actor = Depends(actor), session: Session = Depends(db.get_db),
              provider: NavigatorProvider = Depends(get_navigator_provider)):
    """Answer a nurse question using scoped synthetic data and a configured provider."""
    require(current, "nurse")
    try:
        return answer(session, current, body, provider)
    except ProviderConfigurationError:
        raise HTTPException(503, "Navigator provider is not configured.") from None
    except ProviderTimeoutError:
        raise HTTPException(504, "Navigator provider timed out.") from None
    except ProviderUpstreamError:
        raise HTTPException(502, "Navigator provider is unavailable.") from None
    except ProviderResponseError:
        raise HTTPException(502, "Navigator provider returned an invalid response.") from None
    except ProviderInputError:
        raise HTTPException(500, "Navigator request could not be prepared.") from None
