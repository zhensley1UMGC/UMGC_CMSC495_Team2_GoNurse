"""Demo identity selection and role checks for the local prototype."""

from typing import Annotated

from fastapi import Header, HTTPException

NURSE = "00000000-0000-4000-8000-000000000001"
OTHER_NURSE = "00000000-0000-4000-8000-000000000002"
ADMIN = "00000000-0000-4000-8000-000000000003"
ACTORS = {"nurse": (NURSE, "nurse"), "nurse2": (OTHER_NURSE, "nurse"), "admin": (ADMIN, "admin")}

Actor = tuple[str, str]


def actor(x_demo_user: Annotated[str | None, Header()] = None) -> Actor:
    """Resolve the selected demo identity; this is not authentication."""
    if x_demo_user not in ACTORS:
        raise HTTPException(401, "Select a demo user.")
    return ACTORS[x_demo_user]


def require(current: Actor, role: str) -> None:
    """Enforce a demo role on an operation."""
    if current[1] != role:
        raise HTTPException(403, "This operation is not permitted for this demo role.")
