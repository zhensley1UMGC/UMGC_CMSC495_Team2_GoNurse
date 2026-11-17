"""Optional end-to-end persistence check against a dedicated PostgreSQL database."""

import os
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app import database
from app.main import app


def _validate_test_database_url(url: str) -> None:
    if not url.startswith("postgresql+psycopg://"):
        pytest.fail("GONURSE_TEST_POSTGRES_URL must use postgresql+psycopg.")
    test_target = make_url(url)
    if test_target.database in {
        "gonurse_app",
        "gonurse_benchmark",
        "gonurse_benchmark_test",
    }:
        pytest.fail("GONURSE_TEST_POSTGRES_URL must use a dedicated test database.")
    test_address = (test_target.host, test_target.port or 5432, test_target.database)
    for setting in (
        "DATABASE_URL",
        "GONURSE_BENCHMARK_DATABASE_URL",
        "GONURSE_BENCHMARK_TEST_DATABASE_URL",
    ):
        other_url = os.environ.get(setting)
        if other_url:
            other_target = make_url(other_url)
            if test_address == (
                other_target.host, other_target.port or 5432, other_target.database
            ):
                pytest.fail(
                    f"GONURSE_TEST_POSTGRES_URL must target a database separate from {setting}."
                )


def test_postgresql_test_url_rejects_benchmark_test_database():
    url = "postgresql+psycopg://localhost/gonurse_benchmark_test"
    with pytest.raises(pytest.fail.Exception, match="dedicated test database"):
        _validate_test_database_url(url)


def test_postgresql_round_trip(monkeypatch):
    """Exercise the main workflow in an isolated, temporary PostgreSQL schema."""
    url = os.environ.get("GONURSE_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("Set GONURSE_TEST_POSTGRES_URL to a dedicated test database.")
    _validate_test_database_url(url)
    # Scope table creation and writes to a uniquely named schema, not public.
    schema = f"gonurse_test_{uuid4().hex}"
    admin = create_engine(url)
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    try:
        monkeypatch.setattr(database, "get_engine", lambda: engine)
        with TestClient(app) as client:
            headers = {"X-Demo-User": "nurse"}
            profile = {"skills": ["mentoring"], "interests": ["education"],
                       "availability": ["weekday_morning"], "recommendations_opt_in": True}
            assert client.put("/api/v1/profile", json=profile, headers=headers).status_code == 201
            result = client.post("/api/v1/recommendations", json={"limit": 5}, headers=headers)
            assert result.status_code == 200
            item = result.json()["items"][0]
            assert item["opportunity"]["title"] == "Nurse mentoring committee"
            assert client.post(f"/api/v1/recommendations/{item['id']}/feedback",
                               json={"rating": "helpful"}, headers=headers).status_code == 201
            request = client.post("/api/v1/support-requests",
                                  json={"subject": "Help", "description": "A demo request."}, headers=headers)
            assert request.status_code == 201
            result = client.patch(f"/api/v1/support-requests/{request.json()['id']}",
                                  json={"status": "closed", "response": "Demo response."},
                                  headers={"X-Demo-User": "admin"})
            assert result.status_code == 200
            assert client.get(f"/api/v1/support-requests/{request.json()['id']}", headers=headers).json()["response"] == "Demo response."
    finally:
        # Remove only the schema created by this test, even when an assertion fails.
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()
