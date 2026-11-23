"""Deterministic and fixed hybrid candidate ranking implementations."""

import math
from collections.abc import Mapping, Sequence

from app import database as db
from app.services.recommendations import rank

RRF_K = 60


def stable_key(opportunity: db.Opportunity) -> tuple[str, str]:
    return opportunity.title.casefold(), opportunity.id


def deterministic_ranking(
    profile: db.Profile,
    opportunities: Sequence[db.Opportunity],
) -> tuple[list[str], dict[str, float]]:
    """Call the production ranker unchanged on the eligible opportunities."""
    ranked = rank(profile, opportunities, len(opportunities))
    scores = {item.id: float(score) for score, item, _ in ranked}
    return [item.id for _, item, _ in ranked], scores


def cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    if len(left) != len(right) or not left:
        raise ValueError("Embedding vectors must have the same non-zero dimension.")
    if any(not math.isfinite(value) for value in (*left, *right)):
        raise ValueError("Embedding vectors must contain only finite numbers.")
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return sum(a * b for a, b in zip(left, right, strict=True)) / (left_norm * right_norm)


def normalized_cosine(similarity: float) -> float:
    return min(1.0, max(0.0, (similarity + 1.0) / 2.0))


def _min_max(scores: Mapping[str, float], ids: Sequence[str]) -> dict[str, float]:
    values = [scores[item_id] for item_id in ids]
    low, high = min(values, default=0.0), max(values, default=0.0)
    if high == low:
        return {item_id: 0.0 for item_id in ids}
    return {item_id: (scores[item_id] - low) / (high - low) for item_id in ids}


def hybrid_ranking(
    name: str,
    deterministic_order: Sequence[str],
    deterministic_scores: Mapping[str, float],
    cosine_scores: Mapping[str, float],
    opportunities: Sequence[db.Opportunity],
    limit: int = 5,
) -> list[str]:
    """Return one predeclared hybrid without tuning on the labels."""
    ids = [item.id for item in opportunities]
    if set(deterministic_scores) != set(ids) or set(cosine_scores) != set(ids):
        raise ValueError("Every eligible opportunity must have deterministic and semantic scores.")
    by_id = {item.id: item for item in opportunities}
    det_normalized = _min_max(deterministic_scores, ids)
    semantic_normalized = {
        item_id: normalized_cosine(cosine_scores[item_id]) for item_id in ids
    }
    deterministic_positions = {item_id: position for position, item_id in enumerate(deterministic_order, 1)}
    semantic_order = sorted(ids, key=lambda item_id: (-cosine_scores[item_id], stable_key(by_id[item_id])))
    semantic_positions = {item_id: position for position, item_id in enumerate(semantic_order, 1)}

    if name == "hybrid_equal_weight_minmax":
        order = sorted(
            ids,
            key=lambda item_id: (
                -(det_normalized[item_id] + semantic_normalized[item_id]) / 2,
                stable_key(by_id[item_id]),
            ),
        )
    elif name == "hybrid_deterministic_then_semantic":
        order = sorted(
            ids,
            key=lambda item_id: (
                -deterministic_scores[item_id],
                -cosine_scores[item_id],
                stable_key(by_id[item_id]),
            ),
        )
    elif name == "hybrid_rrf_k60":
        order = sorted(
            ids,
            key=lambda item_id: (
                -(1 / (RRF_K + deterministic_positions[item_id])
                  + 1 / (RRF_K + semantic_positions[item_id])),
                stable_key(by_id[item_id]),
            ),
        )
    else:
        raise ValueError(f"Unknown hybrid ranker: {name}.")
    return order[:limit]


def hybrid_rankings(
    deterministic_order: Sequence[str],
    deterministic_scores: Mapping[str, float],
    cosine_scores: Mapping[str, float],
    opportunities: Sequence[db.Opportunity],
    limit: int = 5,
) -> dict[str, list[str]]:
    """Return all three fixed hybrids for focused unit-test comparisons."""
    names = (
        "hybrid_equal_weight_minmax",
        "hybrid_deterministic_then_semantic",
        "hybrid_rrf_k60",
    )
    return {
        name: hybrid_ranking(name, deterministic_order, deterministic_scores, cosine_scores, opportunities, limit)
        for name in names
    }
