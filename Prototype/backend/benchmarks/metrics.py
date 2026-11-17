"""Per-query and macro-averaged recommendation ranking metrics."""

import math
from collections import defaultdict
from collections.abc import Mapping, Sequence

K = 5


def query_metrics(
    ranking: Sequence[str],
    grades: Mapping[str, int],
    eligible_ids: set[str],
    k: int = K,
) -> dict[str, float | None]:
    """Calculate Precision@k, Recall@k, graded NDCG@k, and empty-query accuracy."""
    if k <= 0:
        raise ValueError("k must be positive.")
    relevant = {item_id for item_id in eligible_ids if grades[item_id] >= 2}
    top = list(ranking[:k])
    precision = sum(item_id in relevant for item_id in top) / k
    if relevant:
        recall = sum(item_id in relevant for item_id in top) / len(relevant)
        no_match_exact_empty = None
    else:
        recall = float(not ranking)
        no_match_exact_empty = float(not ranking)

    def dcg(item_ids: Sequence[str]) -> float:
        return sum(
            (2 ** grades[item_id] - 1) / math.log2(position + 2)
            for position, item_id in enumerate(item_ids[:k])
            if item_id in eligible_ids
        )

    actual_dcg = dcg(top)
    ideal_ids = sorted(eligible_ids, key=lambda item_id: (-grades[item_id], item_id))
    ideal_dcg = dcg(ideal_ids)
    ndcg = actual_dcg / ideal_dcg if ideal_dcg else float(not ranking)
    return {
        "precision_at_5": precision,
        "recall_at_5": recall,
        "ndcg_at_5": ndcg,
        "no_match_exact_empty": no_match_exact_empty,
    }


def macro_average(rows: Sequence[Mapping[str, float | None]]) -> dict[str, float]:
    """Macro-average per-query values and calculate exact-empty rate on no-match queries."""
    result: dict[str, float] = {}
    for metric in ("precision_at_5", "recall_at_5", "ndcg_at_5"):
        values = [row[metric] for row in rows if row[metric] is not None]
        result[metric] = sum(values) / len(values) if values else 0.0
    empty_values = [row["no_match_exact_empty"] for row in rows if row["no_match_exact_empty"] is not None]
    result["no_match_exact_empty_rate"] = (
        sum(empty_values) / len(empty_values) if empty_values else 0.0
    )
    return result


def aggregate_by_category(
    rows_by_profile: Mapping[str, Mapping[str, float | None]],
    profile_tags: Mapping[str, frozenset[str]],
) -> dict[str, dict[str, float]]:
    grouped: dict[str, list[Mapping[str, float | None]]] = defaultdict(list)
    for profile_id, metrics in rows_by_profile.items():
        for category in profile_tags[profile_id]:
            grouped[category].append(metrics)
    return {category: macro_average(rows) for category, rows in sorted(grouped.items())}
