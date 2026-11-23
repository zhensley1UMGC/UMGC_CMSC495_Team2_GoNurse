"""Offline tests for the synthetic ranking benchmark."""

import copy
import json
import math
import subprocess
from types import SimpleNamespace

import pytest

from app import database as db
from benchmarks.cache import VectorCache, embed_cached
from benchmarks.candidates import (
    cosine_similarity,
    deterministic_ranking,
    hybrid_rankings,
    normalized_cosine,
)
from benchmarks.dataset import load_dataset, validate_dataset
from benchmarks.eligibility import eligible_opportunities
from benchmarks.embeddings import FakeEmbedder, opportunity_text, profile_text
from benchmarks.metrics import query_metrics
from benchmarks import run as benchmark_run
from benchmarks.embeddings import EmbeddingBatch, EmbeddingConfigurationError, OpenAICompatibleEmbedder


def _profile(**overrides):
    values = {
        "id": "p1",
        "skills": ["critical care"],
        "interests": ["education"],
        "availability": ["weekday_morning"],
        "recommendations_opt_in": True,
    }
    values.update(overrides)
    return db.Profile(**values)


def _opportunity(item_id, title, **overrides):
    values = {
        "id": item_id,
        "title": title,
        "description": "Synthetic opportunity.",
        "category": "acute care",
        "required_skills": [],
        "interests": [],
        "availability": [],
        "status": "open",
    }
    values.update(overrides)
    return db.Opportunity(**values)


def test_benchmark_dotenv_settings_and_process_precedence(monkeypatch, tmp_path):
    env_path = tmp_path / ".env"
    env_path.write_text(
        'GONURSE_EMBEDDING_MODEL="file-model"\n'
        'GONURSE_EMBEDDING_API_KEY=file-key\n'
        'GONURSE_BENCHMARK_DATABASE_URL=postgresql+psycopg://benchmark\n'
        'DATABASE_URL=postgresql+psycopg://application\n',
        encoding="utf-8",
    )
    monkeypatch.setattr(benchmark_run, "ENV_PATH", env_path)
    for name in (*benchmark_run.BENCHMARK_SETTINGS, "DATABASE_URL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("GONURSE_EMBEDDING_MODEL", "process-model")
    settings = benchmark_run._benchmark_settings()
    embedder = OpenAICompatibleEmbedder.from_environment(settings)
    assert embedder.model == "process-model"
    assert embedder.api_key == "file-key"
    assert settings["GONURSE_BENCHMARK_DATABASE_URL"] == "postgresql+psycopg://benchmark"
    assert "DATABASE_URL" not in settings
    assert "GONURSE_EMBEDDING_API_KEY" not in benchmark_run.os.environ

    monkeypatch.setenv("GONURSE_BENCHMARK_DATABASE_URL", "process-database")
    monkeypatch.setenv("DATABASE_URL", "legacy-process-database")
    settings = benchmark_run._benchmark_settings()
    assert settings["GONURSE_BENCHMARK_DATABASE_URL"] == "process-database"
    assert settings["DATABASE_URL"] == "legacy-process-database"


def test_benchmark_dotenv_invalid_or_unreadable_is_explicit(monkeypatch, tmp_path):
    env_path = tmp_path / ".env"
    env_path.write_text("GONURSE_EMBEDDING_MODEL\n", encoding="utf-8")
    monkeypatch.setattr(benchmark_run, "ENV_PATH", env_path)
    monkeypatch.delenv("GONURSE_EMBEDDING_MODEL", raising=False)
    with pytest.raises(EmbeddingConfigurationError, match="must have a value"):
        benchmark_run._benchmark_settings()
    monkeypatch.setattr(benchmark_run, "ENV_PATH", tmp_path)
    with pytest.raises(EmbeddingConfigurationError, match="could not be read"):
        benchmark_run._benchmark_settings()


def test_git_worktree_dirty_reports_unavailable_and_changes(monkeypatch):
    monkeypatch.setattr(benchmark_run.subprocess, "run", lambda *args, **kwargs: SimpleNamespace(stdout=""))
    assert benchmark_run._git_worktree_dirty() is False
    monkeypatch.setattr(benchmark_run.subprocess, "run", lambda *args, **kwargs: SimpleNamespace(stdout=" M file\n"))
    assert benchmark_run._git_worktree_dirty() is True

    def unavailable(*args, **kwargs):
        raise subprocess.CalledProcessError(1, "git")

    monkeypatch.setattr(benchmark_run.subprocess, "run", unavailable)
    assert benchmark_run._git_worktree_dirty() is None


def test_checked_in_dataset_has_complete_explicit_grades_and_required_coverage():
    dataset = load_dataset()
    assert len(dataset.profiles) == 25
    assert len(dataset.opportunities) == 100
    assert sum(map(len, dataset.grades.values())) == 2500


def test_dataset_validator_rejects_incomplete_pair_labels_and_invalid_grades():
    from pathlib import Path

    raw = json.loads((Path(__file__).parents[1] / "benchmarks/data/ranker_cases.json").read_text())
    incomplete = copy.deepcopy(raw)
    del incomplete["judgments"][0]["grades"]["opportunity-001"]
    with pytest.raises(ValueError, match="missing IDs"):
        validate_dataset(incomplete)

    invalid_grade = copy.deepcopy(raw)
    invalid_grade["judgments"][0]["grades"]["opportunity-001"] = 4
    with pytest.raises(ValueError, match="integer from 0 to 3"):
        validate_dataset(invalid_grade)

    unknown_tag = copy.deepcopy(raw)
    unknown_tag["profiles"][0]["scenario_tags"].append("unreviewed_case")
    with pytest.raises(ValueError, match="Unknown scenario tags"):
        validate_dataset(unknown_tag)


def test_metrics_use_fixed_precision_denominator_and_graded_ndcg():
    grades = {"a": 3, "b": 2, "c": 1, "d": 0}
    result = query_metrics(["a", "c"], grades, set(grades))
    ideal_dcg = 7 + 3 / math.log2(3) + 1 / 2
    actual_dcg = 7 + 1 / math.log2(3)
    assert result["precision_at_5"] == pytest.approx(0.2)
    assert result["recall_at_5"] == pytest.approx(0.5)
    assert result["ndcg_at_5"] == pytest.approx(actual_dcg / ideal_dcg)


def test_cosine_similarity_is_mapped_to_unit_interval():
    assert cosine_similarity([1.0, 0.0], [1.0, 0.0]) == pytest.approx(1.0)
    assert cosine_similarity([1.0, 0.0], [-1.0, 0.0]) == pytest.approx(-1.0)
    assert normalized_cosine(-1.0) == 0.0
    assert normalized_cosine(0.0) == 0.5
    assert normalized_cosine(1.0) == 1.0


def test_empty_relevance_obeys_correct_empty_and_no_match_conventions():
    grades = {"irrelevant": 0}
    eligible = set(grades)
    empty = query_metrics([], grades, eligible)
    nonempty = query_metrics(["irrelevant"], grades, eligible)
    assert empty["recall_at_5"] == 1
    assert empty["ndcg_at_5"] == 1
    assert empty["no_match_exact_empty"] == 1
    assert nonempty["recall_at_5"] == 0
    assert nonempty["ndcg_at_5"] == 0
    assert nonempty["no_match_exact_empty"] == 0
    weak_only = query_metrics(["weak"], {"weak": 1}, {"weak"})
    assert weak_only["recall_at_5"] == 0
    assert weak_only["ndcg_at_5"] == 1


def test_checked_in_active_no_match_case_has_eligible_results_and_no_relevant_labels():
    dataset = load_dataset()
    profile = next(item for item in dataset.profiles if item.id == "profile-04")
    eligible = eligible_opportunities(profile, dataset.opportunities, "strict")
    eligible_ids = {item.id for item in eligible}
    assert eligible
    assert all(dataset.grades[profile.id][item_id] < 2 for item_id in eligible_ids)

    ranking, _ = deterministic_ranking(profile, eligible)
    metrics = query_metrics(ranking, dataset.grades[profile.id], eligible_ids)
    assert ranking
    assert metrics["recall_at_5"] == 0
    assert metrics["no_match_exact_empty"] == 0


def test_eligibility_keeps_all_hard_gates():
    profile = _profile()
    opportunities = [
        _opportunity("skill", "Skill mismatch", required_skills=["ICU"]),
        _opportunity("closed", "Closed", status="closed"),
        _opportunity("schedule", "Schedule mismatch", availability=["night"]),
        _opportunity("eligible", "Eligible"),
    ]
    assert [item.id for item in eligible_opportunities(profile, opportunities, "strict")] == ["eligible"]
    assert eligible_opportunities(_profile(recommendations_opt_in=False), opportunities, "strict") == []
    with pytest.raises(ValueError, match="Unknown eligibility mode"):
        eligible_opportunities(profile, opportunities, "experimental_relaxed_skills")


def test_semantic_synonym_can_be_relevant_while_strict_skill_gate_excludes_it():
    dataset = load_dataset()
    profile = next(item for item in dataset.profiles if item.id == "profile-01")
    opportunity = next(item for item in dataset.opportunities if item.id == "opportunity-001")
    assert dataset.grades[profile.id][opportunity.id] >= 2
    assert opportunity not in eligible_opportunities(profile, [opportunity], "strict")


def test_deterministic_and_hybrid_ties_are_stable():
    profile = _profile()
    items = [
        _opportunity("z", "alpha"),
        _opportunity("b", "Alpha"),
        _opportunity("a", "Beta"),
    ]
    expected = ["b", "z", "a"]
    first_order, first_scores = deterministic_ranking(profile, items)
    second_order, second_scores = deterministic_ranking(profile, items)
    assert first_order == second_order == expected
    assert first_scores == second_scores

    cosine = {"z": 0.3, "b": 0.3, "a": 0.3}
    rankings = hybrid_rankings(first_order, first_scores, cosine, items)
    assert all(ranking == expected for ranking in rankings.values())
    assert rankings == hybrid_rankings(first_order, first_scores, cosine, items)


def test_hybrid_variants_apply_different_predeclared_ordering_rules():
    items = [_opportunity("a", "Zeta"), _opportunity("b", "Alpha")]
    rankings = hybrid_rankings(
        ["a", "b"],
        {"a": 2.0, "b": 0.0},
        {"a": -1.0, "b": 1.0},
        items,
    )
    assert rankings["hybrid_equal_weight_minmax"] == ["b", "a"]
    assert rankings["hybrid_deterministic_then_semantic"] == ["a", "b"]
    assert rankings["hybrid_rrf_k60"] == ["b", "a"]


def test_embedding_text_composition_uses_fixed_normalized_fields_only():
    profile = _profile(id="private-id")
    opportunity = _opportunity("private-id", "  ICU  ", status="closed")
    assert profile_text(profile) == (
        "Profile skills: critical care\n"
        "Profile interests: education\n"
        "Profile availability: weekday_morning"
    )
    text = opportunity_text(opportunity)
    assert text == (
        "Opportunity title: icu\n"
        "Opportunity description: synthetic opportunity.\n"
        "Opportunity category: acute care\n"
        "Opportunity required skills: \n"
        "Opportunity interests: \n"
        "Opportunity availability: "
    )
    assert "private-id" not in text
    assert "closed" not in text


def test_fake_embedder_is_repeatable_and_maps_the_documented_synonym(tmp_path):
    embedder = FakeEmbedder()
    first = embedder.embed(["critical care"])
    second = embedder.embed(["critical care", "ICU"])
    assert first.vectors == second.vectors[:1]
    assert second.vectors[0] == second.vectors[1]

    cache = VectorCache(tmp_path / "vectors.sqlite3")
    try:
        vectors1, _, _ = embed_cached(embedder, ["critical care"], cache)
        vectors2, _, _ = embed_cached(embedder, ["critical care"], cache)
        assert vectors1 == vectors2
        assert (cache.hits, cache.misses) == (1, 1)
        cache.put(embedder.cache_key, "another text", [1.0] * 64)
        with pytest.raises(ValueError, match="different dimension"):
            cache.put(embedder.cache_key, "third text", [1.0] * 65)
        cache.get("different-model", "critical care")
        assert cache.misses == 2
    finally:
        cache.close()


def test_cache_isolates_providers_with_the_same_model(tmp_path, monkeypatch):
    first = OpenAICompatibleEmbedder("https://first.example/v1", "same-model", "key", 30)
    second = OpenAICompatibleEmbedder("https://second.example/v1", "same-model", "key", 30)
    monkeypatch.setattr(first, "embed", lambda texts: EmbeddingBatch([[1.0, 0.0]], 1, 0.0))
    monkeypatch.setattr(second, "embed", lambda texts: EmbeddingBatch([[0.0, 1.0]], 1, 0.0))
    cache = VectorCache(tmp_path / "vectors.sqlite3")
    try:
        cache.put("same-model", "text", [0.5, 0.5])
        assert embed_cached(first, ["text"], cache)[0] == [[1.0, 0.0]]
        assert embed_cached(second, ["text"], cache)[0] == [[0.0, 1.0]]
        assert embed_cached(first, ["text"], cache)[0] == [[1.0, 0.0]]
        assert (cache.hits, cache.misses) == (1, 2)
    finally:
        cache.close()
