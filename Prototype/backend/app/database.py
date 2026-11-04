"""Persistence models and database sessions for the local-only prototype.

The application uses PostgreSQL in normal operation. API tests override the
engine with SQLite, so these models deliberately use portable SQLAlchemy types.
"""

import os
from datetime import datetime, timezone
from functools import lru_cache

from sqlalchemy import JSON, Boolean, DateTime, String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


def now():
    """Return a timezone-aware UTC timestamp for persisted records."""
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    """Collect the ORM mappings used when the prototype creates its tables."""
    pass


class Profile(Base):
    """Store one demo nurse's matching inputs and opt-in preference."""
    __tablename__ = "profiles"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    skills: Mapped[list] = mapped_column(JSON, default=list)
    interests: Mapped[list] = mapped_column(JSON, default=list)
    availability: Mapped[list] = mapped_column(JSON, default=list)
    recommendations_opt_in: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Opportunity(Base):
    """Store an opportunity and its required skills and schedule labels."""
    __tablename__ = "opportunities"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(String(2000))
    category: Mapped[str] = mapped_column(String(50))
    required_skills: Mapped[list] = mapped_column(JSON, default=list)
    interests: Mapped[list] = mapped_column(JSON, default=list)
    availability: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(20))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Recommendation(Base):
    """Store an owned result and the listing as it appeared when generated."""
    __tablename__ = "recommendations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(36), index=True)
    # A snapshot preserves the explanation's original context if a listing changes.
    opportunity_snapshot: Mapped[dict] = mapped_column(JSON)
    rank: Mapped[int]
    explanation: Mapped[str] = mapped_column(String(2000))
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Feedback(Base):
    """Store a nurse's response to a specific generated recommendation."""
    __tablename__ = "feedback"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(36), index=True)
    recommendation_id: Mapped[str] = mapped_column(String(36))
    rating: Mapped[str] = mapped_column(String(20))
    comment: Mapped[str | None] = mapped_column(String(2000))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class SupportRequest(Base):
    """Store a nurse-initiated request and an administrator's response."""
    __tablename__ = "support_requests"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(36), index=True)
    subject: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(String(2000))
    status: Mapped[str] = mapped_column(String(20), default="open")
    response: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AuditEvent(Base):
    """Record event identifiers without storing full profiles or messages."""
    __tablename__ = "audit_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    actor_id: Mapped[str] = mapped_column(String(36))
    event: Mapped[str] = mapped_column(String(100))
    resource_id: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


@lru_cache
def get_engine():
    """Create one reusable PostgreSQL engine from the local environment."""
    url = os.environ.get("DATABASE_URL")
    if not url or not url.startswith("postgresql+psycopg://"):
        raise RuntimeError("Set DATABASE_URL to a postgresql+psycopg:// connection string.")
    return create_engine(url, pool_pre_ping=True)


def get_db():
    """Give each API request a session that closes when the request finishes."""
    with sessionmaker(bind=get_engine(), expire_on_commit=False)() as session:
        yield session
