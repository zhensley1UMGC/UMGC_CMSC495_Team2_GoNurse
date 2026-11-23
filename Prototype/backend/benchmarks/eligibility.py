"""Benchmark-local hard eligibility gates."""

from typing import Literal

from app import database as db

Mode = Literal["strict"]


def _normalized(values: list[str]) -> set[str]:
    return {value.strip().casefold() for value in values}


def eligible_opportunities(
    profile: db.Profile,
    opportunities: list[db.Opportunity] | tuple[db.Opportunity, ...],
    mode: Mode,
) -> list[db.Opportunity]:
    """Apply opt-in, open-status, skill, and availability gates before ranking."""
    if mode != "strict":
        raise ValueError(f"Unknown eligibility mode: {mode}.")
    if not profile.recommendations_opt_in:
        return []

    profile_skills = _normalized(profile.skills)
    profile_availability = _normalized(profile.availability)
    eligible = []
    for opportunity in opportunities:
        if opportunity.status != "open":
            continue
        required = _normalized(opportunity.required_skills)
        if not required.issubset(profile_skills):
            continue
        if opportunity.availability and not (profile_availability & _normalized(opportunity.availability)):
            continue
        eligible.append(opportunity)
    return eligible
