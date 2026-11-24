"""Opt-in pgvector integration test isolated from the application database."""

import os

import pytest
from sqlalchemy import create_engine, text

from benchmarks.vector_store import PgvectorStore, has_vector_extension


def test_pgvector_cosine_query_and_owned_schema_cleanup():
    url = os.environ.get("GONURSE_BENCHMARK_TEST_DATABASE_URL")
    if not url:
        pytest.skip(
            "Set GONURSE_BENCHMARK_TEST_DATABASE_URL to a dedicated PostgreSQL database with pgvector."
        )
    if not url.startswith("postgresql+psycopg://"):
        pytest.fail("GONURSE_BENCHMARK_TEST_DATABASE_URL must use postgresql+psycopg.")
    if not has_vector_extension(url):
        pytest.skip("The dedicated benchmark test database does not have the vector extension installed.")

    schema = None
    with PgvectorStore.open(url, "test-model", 3, allow_schema_create=True) as store:
        schema = store.schema
        store.insert_vectors({
            "opportunity:a": [1.0, 0.0, 0.0],
            "opportunity:b": [0.0, 1.0, 0.0],
        })
        scores = store.cosine_scores([1.0, 0.0, 0.0], ["opportunity:b", "opportunity:a"])
        assert scores["opportunity:a"] == pytest.approx(1.0)
        assert scores["opportunity:b"] == pytest.approx(0.0)
        assert sorted(scores, key=scores.get, reverse=True) == ["opportunity:a", "opportunity:b"]

    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            exists = connection.execute(
                text("SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = :schema)"),
                {"schema": schema},
            ).scalar_one()
        assert not exists
    finally:
        engine.dispose()
