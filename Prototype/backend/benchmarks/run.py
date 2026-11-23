"""Run the manual synthetic benchmark from Prototype/backend."""

import hashlib
import importlib.util
import json
import math
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import dotenv_values
from sqlalchemy.exc import SQLAlchemyError

from benchmarks.cache import VectorCache, embed_cached
from benchmarks.candidates import deterministic_ranking, hybrid_ranking, stable_key
from benchmarks.dataset import BenchmarkDataset, load_dataset
from benchmarks.eligibility import Mode, eligible_opportunities
from benchmarks.embeddings import EmbeddingConfigurationError, OpenAICompatibleEmbedder, opportunity_text, profile_text
from benchmarks.metrics import aggregate_by_category, macro_average, query_metrics
from benchmarks.vector_store import PgvectorStore, VectorExtensionUnavailable, has_vector_extension

ROOT = Path(__file__).resolve().parents[1]
RESULTS_DIR = ROOT / ".benchmark-results"
CACHE_PATH = ROOT / ".benchmark-cache" / "embeddings.sqlite3"
ENV_PATH = ROOT / ".env"
BENCHMARK_SETTINGS = (
    "GONURSE_EMBEDDING_MODEL",
    "GONURSE_EMBEDDING_API_KEY",
    "GONURSE_EMBEDDING_BASE_URL",
    "GONURSE_EMBEDDING_TIMEOUT_SECONDS",
    "GONURSE_EMBEDDING_PRICE_PER_1M_TOKENS",
    "GONURSE_BENCHMARK_DATABASE_URL",
    "GONURSE_BENCHMARK_ALLOW_SCHEMA_CREATE",
)
MODES: tuple[Mode, ...] = ("strict",)
CANDIDATE_NAMES = (
    "deterministic",
    "embedding_pgvector",
    "hybrid_equal_weight_minmax",
    "hybrid_deterministic_then_semantic",
    "hybrid_rrf_k60",
)


def _benchmark_settings() -> dict[str, str]:
    try:
        with ENV_PATH.open(encoding="utf-8") as env_file:
            file_values = dotenv_values(stream=env_file, interpolate=False)
    except FileNotFoundError:
        file_values = {}
    except (OSError, UnicodeError):
        raise EmbeddingConfigurationError("The benchmark .env file could not be read.") from None

    settings = {}
    for name in BENCHMARK_SETTINGS:
        if name in os.environ:
            settings[name] = os.environ[name]
        elif name in file_values:
            value = file_values[name]
            if value is None:
                raise EmbeddingConfigurationError(f"The {name} setting in .env must have a value.")
            settings[name] = value
    if "DATABASE_URL" in os.environ:
        settings["DATABASE_URL"] = os.environ["DATABASE_URL"]
    return settings


def _git_commit() -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return "unavailable"
    return result.stdout.strip() or "unavailable"


def _git_worktree_dirty() -> bool | None:
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain", "--untracked-files=normal"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return bool(result.stdout.strip())


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, math.ceil(percentile * len(ordered)) - 1)
    return ordered[index]


def _latency_summary(seconds: list[float]) -> dict[str, float | None]:
    milliseconds = [value * 1000 for value in seconds]
    return {
        "p50_ms": _percentile(milliseconds, 0.50),
        "p95_ms": _percentile(milliseconds, 0.95),
    }


def _evaluate(
    rankings: dict[str, list[str]],
    durations: list[float],
    dataset: BenchmarkDataset,
    eligible_by_profile: dict[str, list[str]],
) -> dict[str, object]:
    rows_by_profile = {
        profile_id: query_metrics(
            ranking,
            dataset.grades[profile_id],
            set(eligible_by_profile[profile_id]),
        )
        for profile_id, ranking in rankings.items()
    }
    return {
        "status": "complete",
        "query_count": len(rankings),
        "metrics": macro_average(list(rows_by_profile.values())),
        "per_category": aggregate_by_category(rows_by_profile, dataset.profile_tags),
        "query_latency": _latency_summary(durations),
    }


def _eligible_for_mode(
    dataset: BenchmarkDataset,
    mode: Mode,
) -> tuple[dict[str, list], dict[str, list[str]]]:
    eligible_objects: dict[str, list] = {}
    eligible_ids: dict[str, list[str]] = {}
    for profile in dataset.profiles:
        eligible = eligible_opportunities(profile, dataset.opportunities, mode)
        eligible_objects[profile.id] = eligible
        eligible_ids[profile.id] = [item.id for item in eligible]
    return eligible_objects, eligible_ids


def _print_summary(results: dict[str, object]) -> None:
    for mode in MODES:
        print(f"\n{mode}")
        print(
            f"{'candidate':42} {'P@5':>7} {'R@5':>7} {'NDCG@5':>8} "
            f"{'empty':>7} {'p50 ms':>9} {'p95 ms':>9}"
        )
        for candidate, result in results["modes"][mode].items():
            if result["status"] != "complete":
                print(f"{candidate:42} skipped: {result['reason']}")
                continue
            metrics = result["metrics"]
            latency = result["query_latency"]
            print(
                f"{candidate:42} {metrics['precision_at_5']:7.3f} "
                f"{metrics['recall_at_5']:7.3f} {metrics['ndcg_at_5']:8.3f} "
                f"{metrics['no_match_exact_empty_rate']:7.3f} "
                f"{latency['p50_ms']:9.3f} {latency['p95_ms']:9.3f}"
            )


def run() -> int:
    settings = _benchmark_settings()
    dataset_path = ROOT / "benchmarks" / "data" / "ranker_cases.json"
    dataset = load_dataset(dataset_path)
    raw_dataset = dataset_path.read_bytes()
    timestamp = datetime.now(timezone.utc)
    results: dict[str, object] = {
        "metadata": {
            "dataset_sha256": hashlib.sha256(raw_dataset).hexdigest(),
            "git_commit": _git_commit(),
            "git_worktree_dirty": _git_worktree_dirty(),
            "timestamp_utc": timestamp.isoformat(),
            "model": settings.get("GONURSE_EMBEDDING_MODEL") or None,
            "formula_version": "ranker-benchmark-v1",
            "k": 5,
            "hybrid_parameters": {"equal_weight": [0.5, 0.5], "rrf_k": 60},
            "deterministic_constant_score_normalization": 0.0,
            "latency_percentiles": "nearest-rank",
        },
        "modes": {mode: {} for mode in MODES},
        "embedding": {
            "generation_seconds": 0.0,
            "index_build_seconds": 0.0,
            "vector_dimension": None,
            "vector_index_type": None,
            "input_tokens": None,
            "cost": {"available": False, "amount": None, "basis": None},
            "cache": {"hits": 0, "misses": 0},
        },
    }

    eligible_by_mode = {mode: _eligible_for_mode(dataset, mode) for mode in MODES}
    for mode in MODES:
        eligible_objects, eligible_ids = eligible_by_mode[mode]
        rankings: dict[str, list[str]] = {}
        durations = []
        for profile in dataset.profiles:
            start = time.perf_counter()
            order, _ = deterministic_ranking(profile, eligible_objects[profile.id])
            durations.append(time.perf_counter() - start)
            rankings[profile.id] = order[:5]
        results["modes"][mode]["deterministic"] = _evaluate(rankings, durations, dataset, eligible_ids)

    embedding_skip: str | None = None
    embedder: OpenAICompatibleEmbedder | None = None
    try:
        embedder = OpenAICompatibleEmbedder.from_environment(settings)
    except EmbeddingConfigurationError as error:
        embedding_skip = str(error)

    database_url = settings.get("GONURSE_BENCHMARK_DATABASE_URL", settings.get("DATABASE_URL"))
    allow_schema_create = settings.get("GONURSE_BENCHMARK_ALLOW_SCHEMA_CREATE") == "YES"
    if embedding_skip is None and not database_url:
        embedding_skip = "Set GONURSE_BENCHMARK_DATABASE_URL to a dedicated benchmark database."
    if embedding_skip is None and not allow_schema_create:
        embedding_skip = (
            "Set GONURSE_BENCHMARK_ALLOW_SCHEMA_CREATE=YES only after confirming the database "
            "is a dedicated benchmark database."
        )
    if embedding_skip is None and database_url is not None:
        print(
            "WARNING: The database URL must identify a dedicated benchmark database; "
            "the run creates and drops only its UUID-named benchmark schema.",
            file=sys.stderr,
        )
    if embedding_skip is None and database_url:
        try:
            if not has_vector_extension(database_url):
                embedding_skip = (
                    "pgvector extension is unavailable; install vector explicitly in the dedicated "
                    "benchmark database."
                )
        except SQLAlchemyError:
            embedding_skip = "Could not preflight the dedicated benchmark database (SQLAlchemy connection error)."
        except (ValueError, OSError):
            embedding_skip = "Could not preflight the benchmark database URL; verify its PostgreSQL connection configuration."

    if embedding_skip is None and importlib.util.find_spec("pgvector") is None:
        embedding_skip = "Install requirements-benchmark.txt to use the pgvector candidate."

    if embedding_skip is None and embedder is not None and database_url is not None:
        cache = VectorCache(CACHE_PATH)
        try:
            profile_texts = [profile_text(profile) for profile in dataset.profiles]
            opportunity_texts = [opportunity_text(item) for item in dataset.opportunities]
            texts = profile_texts + opportunity_texts
            generation_start = time.perf_counter()
            all_vectors, token_count, _ = embed_cached(embedder, texts, cache)
            results["embedding"]["generation_seconds"] = time.perf_counter() - generation_start
            results["embedding"]["input_tokens"] = token_count
            results["embedding"]["cache"] = {"hits": cache.hits, "misses": cache.misses}

            model_price = settings.get("GONURSE_EMBEDDING_PRICE_PER_1M_TOKENS")
            if model_price is not None and token_count is not None:
                try:
                    price = float(model_price)
                except ValueError as error:
                    raise ValueError("GONURSE_EMBEDDING_PRICE_PER_1M_TOKENS must be non-negative.") from error
                if not math.isfinite(price) or price < 0:
                    raise ValueError("GONURSE_EMBEDDING_PRICE_PER_1M_TOKENS must be non-negative.")
                results["embedding"]["cost"] = {
                    "available": True,
                    "amount": token_count * price / 1_000_000,
                    "basis": "operator-supplied price per 1M input tokens",
                }

            profile_vectors = {
                profile.id: all_vectors[index] for index, profile in enumerate(dataset.profiles)
            }
            offset = len(dataset.profiles)
            opportunity_vectors = {
                item.id: all_vectors[offset + index] for index, item in enumerate(dataset.opportunities)
            }
            vectors = {
                **{f"profile:{profile_id}": vector for profile_id, vector in profile_vectors.items()},
                **{f"opportunity:{item_id}": vector for item_id, vector in opportunity_vectors.items()},
            }
            dimension = len(all_vectors[0])
            results["embedding"]["vector_dimension"] = dimension

            index_start = time.perf_counter()
            store = PgvectorStore.open(database_url, embedder.model, dimension, allow_schema_create)
            try:
                results["embedding"]["vector_index_type"] = store.index_type
                store.insert_vectors(vectors)
                results["embedding"]["index_build_seconds"] = time.perf_counter() - index_start
                item_by_id = {item.id: item for item in dataset.opportunities}
                rankings_by_mode = {}
                durations_by_mode = {}
                for mode in MODES:
                    eligible_objects, eligible_ids = eligible_by_mode[mode]
                    candidate_rankings = {name: {} for name in CANDIDATE_NAMES[1:]}
                    candidate_durations = {name: [] for name in CANDIDATE_NAMES[1:]}
                    rankings_by_mode[mode] = candidate_rankings
                    durations_by_mode[mode] = candidate_durations
                    for profile in dataset.profiles:
                        eligible = eligible_objects[profile.id]
                        deterministic_start = time.perf_counter()
                        deterministic_order, deterministic_scores = deterministic_ranking(profile, eligible)
                        deterministic_duration = time.perf_counter() - deterministic_start
                        hybrid_deterministic_order = sorted(
                            deterministic_scores,
                            key=lambda item_id: (
                                -deterministic_scores[item_id],
                                stable_key(item_by_id[item_id]),
                            ),
                        )

                        start = time.perf_counter()
                        prefixed_ids = [f"opportunity:{item_id}" for item_id in eligible_ids[profile.id]]
                        prefixed_scores = store.cosine_scores(
                            profile_vectors[profile.id],
                            prefixed_ids,
                        )
                        cosine_scores = {
                            item_id.removeprefix("opportunity:"): score
                            for item_id, score in prefixed_scores.items()
                        }
                        pg_order = sorted(
                            cosine_scores,
                            key=lambda item_id: (
                                -cosine_scores[item_id],
                                stable_key(item_by_id[item_id]),
                            ),
                        )[:5]
                        semantic_duration = time.perf_counter() - start
                        candidate_durations["embedding_pgvector"].append(semantic_duration)
                        candidate_rankings["embedding_pgvector"][profile.id] = pg_order

                        for name in CANDIDATE_NAMES[2:]:
                            start = time.perf_counter()
                            order = hybrid_ranking(
                                name,
                                hybrid_deterministic_order,
                                deterministic_scores,
                                cosine_scores,
                                eligible,
                            )
                            candidate_rankings[name][profile.id] = order
                            candidate_durations[name].append(
                                deterministic_duration + semantic_duration + time.perf_counter() - start
                            )
                for mode in MODES:
                    eligible_ids = eligible_by_mode[mode][1]
                    for name in CANDIDATE_NAMES[1:]:
                        results["modes"][mode][name] = _evaluate(
                            rankings_by_mode[mode][name],
                            durations_by_mode[mode][name],
                            dataset,
                            eligible_ids,
                        )
            finally:
                store.close()
        except (EmbeddingConfigurationError, httpx.HTTPError, ValueError, ImportError) as error:
            embedding_skip = str(error)
        except VectorExtensionUnavailable as error:
            embedding_skip = str(error)
        except SQLAlchemyError:
            embedding_skip = "pgvector setup or query failed (SQLAlchemy error); no provider or database details recorded."
        finally:
            results["embedding"]["cache"] = {"hits": cache.hits, "misses": cache.misses}
            cache.close()

    if embedding_skip is not None:
        print(f"Embedding/pgvector candidates skipped: {embedding_skip}", file=sys.stderr)
        for mode in MODES:
            for candidate in CANDIDATE_NAMES[1:]:
                results["modes"][mode][candidate] = {
                    "status": "skipped",
                    "reason": embedding_skip,
                }
    results["status"] = (
        "complete"
        if all(results["modes"][mode][candidate]["status"] == "complete"
               for mode in MODES for candidate in CANDIDATE_NAMES)
        else "partial"
    )

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    result_path = RESULTS_DIR / f"ranker-benchmark-{timestamp.strftime('%Y%m%dT%H%M%SZ')}.json"
    result_path.write_text(json.dumps(results, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    _print_summary(results)
    print(f"\nRun status: {results['status']}; structured results: {result_path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
