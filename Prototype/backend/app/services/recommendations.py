"""Deterministic eligibility and ranking for the prototype recommender."""

from collections.abc import Iterable

from .. import database as db


def normalized(values: list[str]) -> set[str]:
    """Normalize free-form skill and availability labels for exact comparison."""
    return {value.strip().casefold() for value in values}


def rank(profile: db.Profile, opportunities: Iterable[db.Opportunity], limit: int) -> list[tuple[int, db.Opportunity, str]]:
    """Filter eligible listings, then deterministically rank and explain them.

    All required skills must match. A specified opportunity schedule needs at
    least one matching profile label; an empty schedule has no restriction.
    Score ties are ordered by title and ID to keep results repeatable.
    """
    ranked = []
    for item in opportunities:
        skills = normalized(profile.skills)
        if not normalized(item.required_skills).issubset(skills):
            continue
        if item.availability and not (normalized(profile.availability) & normalized(item.availability)):
            continue
        matching_skills = normalized(item.required_skills) & skills
        matching_interests = normalized(item.interests) & normalized(profile.interests)
        score = len(matching_skills) + len(matching_interests)
        explanation = f"Eligible; matched {len(matching_skills)} required skills and {len(matching_interests)} interests."
        ranked.append((score, item, explanation))
    ranked.sort(key=lambda result: (-result[0], result[1].title.casefold(), result[1].id))
    return ranked[:limit]
