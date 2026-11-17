"""Load and validate the fixed synthetic ranker benchmark dataset."""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app import database as db

REQUIRED_CASE_TAGS = frozenset({
    "opt_out",
    "open_and_closed",
    "exact_skill_match",
    "missing_required_skill",
    "matching_availability",
    "nonmatching_availability",
    "eligible_no_match",
    "multiple_eligible_ordering",
    "semantic_synonym_ineligible",
})


@dataclass(frozen=True)
class BenchmarkDataset:
    profiles: tuple[db.Profile, ...]
    opportunities: tuple[db.Opportunity, ...]
    profile_tags: dict[str, frozenset[str]]
    grades: dict[str, dict[str, int]]


def _require_string(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty string.")
    return value


def _string_list(value: Any, field: str) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) or not item.strip() for item in value):
        raise ValueError(f"{field} must be a list of non-empty strings.")
    return value


def validate_dataset(data: Any) -> BenchmarkDataset:
    """Validate all records, tags, and explicit profile/opportunity judgments."""
    if (
        not isinstance(data, dict)
        or type(data.get("schema_version")) is not int
        or data.get("schema_version") != 1
    ):
        raise ValueError("Dataset must be an object with schema_version 1.")

    raw_profiles = data.get("profiles")
    raw_opportunities = data.get("opportunities")
    raw_judgments = data.get("judgments")
    if not isinstance(raw_profiles, list) or not raw_profiles:
        raise ValueError("Dataset profiles must be a non-empty list.")
    if not isinstance(raw_opportunities, list) or not raw_opportunities:
        raise ValueError("Dataset opportunities must be a non-empty list.")
    if not isinstance(raw_judgments, list):
        raise ValueError("Dataset judgments must be a list.")

    profiles: list[db.Profile] = []
    profile_ids: set[str] = set()
    profile_tags: dict[str, frozenset[str]] = {}
    for index, row in enumerate(raw_profiles):
        if not isinstance(row, dict):
            raise ValueError(f"profiles[{index}] must be an object.")
        profile_id = _require_string(row.get("id"), f"profiles[{index}].id")
        if profile_id in profile_ids:
            raise ValueError(f"Duplicate profile ID: {profile_id}.")
        profile_ids.add(profile_id)
        tags = _string_list(row.get("scenario_tags"), f"profiles[{index}].scenario_tags")
        unknown_tags = set(tags) - REQUIRED_CASE_TAGS
        if unknown_tags:
            raise ValueError(f"Unknown scenario tags for {profile_id}: {sorted(unknown_tags)}.")
        opt_in = row.get("recommendations_opt_in")
        if not isinstance(opt_in, bool):
            raise ValueError(f"profiles[{index}].recommendations_opt_in must be boolean.")
        profiles.append(db.Profile(
            id=profile_id,
            skills=_string_list(row.get("skills"), f"profiles[{index}].skills"),
            interests=_string_list(row.get("interests"), f"profiles[{index}].interests"),
            availability=_string_list(row.get("availability"), f"profiles[{index}].availability"),
            recommendations_opt_in=opt_in,
        ))
        profile_tags[profile_id] = frozenset(tags)

    opportunities: list[db.Opportunity] = []
    opportunity_ids: set[str] = set()
    for index, row in enumerate(raw_opportunities):
        if not isinstance(row, dict):
            raise ValueError(f"opportunities[{index}] must be an object.")
        opportunity_id = _require_string(row.get("id"), f"opportunities[{index}].id")
        if opportunity_id in opportunity_ids:
            raise ValueError(f"Duplicate opportunity ID: {opportunity_id}.")
        opportunity_ids.add(opportunity_id)
        status = row.get("status")
        if not isinstance(status, str) or status not in {"open", "closed"}:
            raise ValueError(f"opportunities[{index}].status must be open or closed.")
        opportunities.append(db.Opportunity(
            id=opportunity_id,
            title=_require_string(row.get("title"), f"opportunities[{index}].title"),
            description=_require_string(row.get("description"), f"opportunities[{index}].description"),
            category=_require_string(row.get("category"), f"opportunities[{index}].category"),
            required_skills=_string_list(row.get("required_skills"), f"opportunities[{index}].required_skills"),
            interests=_string_list(row.get("interests"), f"opportunities[{index}].interests"),
            availability=_string_list(row.get("availability"), f"opportunities[{index}].availability"),
            status=status,
        ))

    judgment_rows: dict[str, dict[str, int]] = {}
    for index, row in enumerate(raw_judgments):
        if not isinstance(row, dict):
            raise ValueError(f"judgments[{index}] must be an object.")
        profile_id = _require_string(row.get("profile_id"), f"judgments[{index}].profile_id")
        if profile_id not in profile_ids:
            raise ValueError(f"Unknown profile reference in judgments: {profile_id}.")
        if profile_id in judgment_rows:
            raise ValueError(f"Duplicate judgments for profile: {profile_id}.")
        grades = row.get("grades")
        if not isinstance(grades, dict):
            raise ValueError(f"judgments[{index}].grades must be an object.")
        if set(grades) != opportunity_ids:
            missing = sorted(opportunity_ids - set(grades))
            extra = sorted(set(grades) - opportunity_ids)
            raise ValueError(f"Judgments for {profile_id} have missing IDs {missing} and unknown IDs {extra}.")
        for opportunity_id, grade in grades.items():
            if type(grade) is not int or not 0 <= grade <= 3:
                raise ValueError(f"Grade for {profile_id}/{opportunity_id} must be an integer from 0 to 3.")
        judgment_rows[profile_id] = grades

    if set(judgment_rows) != profile_ids:
        missing_profiles = sorted(profile_ids - set(judgment_rows))
        extra_profiles = sorted(set(judgment_rows) - profile_ids)
        raise ValueError(f"Judgment profiles differ: missing {missing_profiles}; unknown {extra_profiles}.")

    present_tags = set().union(*profile_tags.values())
    missing_tags = REQUIRED_CASE_TAGS - present_tags
    if missing_tags:
        raise ValueError(f"Dataset is missing required case-category coverage: {sorted(missing_tags)}.")

    return BenchmarkDataset(
        profiles=tuple(profiles),
        opportunities=tuple(opportunities),
        profile_tags=profile_tags,
        grades=judgment_rows,
    )


def load_dataset(path: Path | None = None) -> BenchmarkDataset:
    """Read the checked-in JSON dataset and validate it before use."""
    dataset_path = path or Path(__file__).parent / "data" / "ranker_cases.json"
    try:
        data = json.loads(dataset_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Could not read benchmark dataset at {dataset_path}: {error}") from error
    return validate_dataset(data)
