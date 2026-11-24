"""Request and response models shared by the API routers."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictStr, field_validator, model_validator


class Input(BaseModel):
    """Reject unexpected fields and normalize text for all request bodies."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @field_validator("*", mode="after")
    @classmethod
    def reject_blank(cls, value):
        """Disallow whitespace-only text and blank entries in string arrays."""
        if isinstance(value, str) and not value.strip():
            raise ValueError("Text must not be blank.")
        if isinstance(value, list) and any(
                isinstance(item, str) and not item.strip() for item in value):
            raise ValueError("Array entries must not be blank.")
        return value


class ProfileInput(Input):
    """Editable matching fields and the explicit recommendation preference."""

    skills: list[Annotated[str, Field(max_length=200)]] = Field(max_length=100)
    interests: list[Annotated[str, Field(max_length=200)]] = Field(max_length=100)
    availability: list[Annotated[str, Field(max_length=200)]] = Field(max_length=100)
    recommendations_opt_in: bool


class OpportunityInput(Input):
    """Administrator-supplied listing, including eligibility and schedule."""

    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=2000)
    category: Literal["project", "committee", "mentoring", "professional_development"]
    required_skills: list[Annotated[str, Field(max_length=200)]] = Field(max_length=100)
    interests: list[Annotated[str, Field(max_length=200)]] = Field(max_length=100)
    availability: list[Annotated[str, Field(max_length=200)]] = Field(max_length=100)
    status: Literal["open", "closed"]


class RecommendationInput(Input):
    """Limit the number of eligible ranked results returned to a nurse."""

    limit: int = Field(default=5, ge=1, le=20)


class FeedbackInput(Input):
    """Record a rating or decline without automatically changing ranking."""

    rating: Literal["helpful", "not_helpful", "declined"]
    comment: str | None = Field(default=None, max_length=2000)


class ConversationTurn(BaseModel):
    """One untrusted user or assistant turn supplied for the current request."""

    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: StrictStr

    @field_validator("content")
    @classmethod
    def content_is_valid(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Conversation content must not be blank.")
        return value

    @model_validator(mode="after")
    def content_is_bounded_by_role(self):
        limit = 2000 if self.role == "user" else 8000
        if len(self.content) > limit:
            raise ValueError("Conversation turn exceeds its size limit.")
        return self


class ChatInput(Input):
    """Identify a question and, optionally, the result it refers to."""

    message: str = Field(min_length=1, max_length=2000)
    recommendation_id: UUID | None = None
    history: list[ConversationTurn] = Field(default_factory=list, max_length=10)

    @field_validator("history")
    @classmethod
    def history_is_bounded_and_complete(cls, value: list[ConversationTurn]) -> list[ConversationTurn]:
        if len(value) % 2:
            raise ValueError("Conversation history must contain complete exchanges.")
        for index, turn in enumerate(value):
            expected_role = "user" if index % 2 == 0 else "assistant"
            if turn.role != expected_role:
                raise ValueError("Conversation history must contain complete exchanges.")
        if sum(len(turn.content) for turn in value) > 25000:
            raise ValueError("Conversation history exceeds its size limit.")
        return value


class SupportInput(Input):
    """Describe a nurse-initiated request for human help."""

    subject: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=2000)


class SupportUpdate(Input):
    """Represent an administrator's status change and optional response."""

    status: Literal["in_review", "closed"]
    response: str | None = Field(default=None, max_length=2000)


class ProfileOutput(BaseModel):
    """Serialize a saved ORM profile for the create/update response."""

    model_config = ConfigDict(from_attributes=True)
    id: str
    skills: list[str]
    interests: list[str]
    availability: list[str]
    recommendations_opt_in: bool
    updated_at: object


class ProfileOptionItem(BaseModel):
    """One canonical value and its display label in the profile catalog."""

    value: str
    label: str


class ProfileOptionsOutput(BaseModel):
    """Selectable profile values grouped by profile field."""

    skills: list[ProfileOptionItem]
    interests: list[ProfileOptionItem]
    availability: list[ProfileOptionItem]
