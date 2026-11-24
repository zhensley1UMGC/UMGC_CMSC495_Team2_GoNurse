"""Queries for the shared profile and opportunity option catalog."""

from sqlalchemy.orm import Session

from ..database import ProfileOption
from ..schemas import ProfileOptionItem, ProfileOptionsOutput


def get_options(session: Session) -> ProfileOptionsOutput:
    """Return selectable values in deterministic display order."""
    grouped: dict[str, list[ProfileOptionItem]] = {
        "skills": [], "interests": [], "availability": [],
    }
    options = session.query(ProfileOption).order_by(
        ProfileOption.category, ProfileOption.sort_order, ProfileOption.value,
    ).all()
    for option in options:
        if option.category in grouped:
            grouped[option.category].append(ProfileOptionItem(value=option.value, label=option.label))
    return ProfileOptionsOutput(**grouped)
