"""Exercise API behavior in isolation using a fresh in-memory database per test."""

from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import Session

from app import database
from app.main import app


@pytest.fixture
def client(monkeypatch):
    """Run application startup against SQLite rather than a real PostgreSQL server."""
    # StaticPool shares the same in-memory database across request threads.
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    monkeypatch.setattr(database, "get_engine", lambda: engine)
    with TestClient(app) as test_client:
        yield test_client
    engine.dispose()


def headers(user="nurse"):
    """Select a demo identity for a request; this is not authentication."""
    return {"X-Demo-User": user}


def profile(opt_in=True, skills=None, availability=None):
    """Build the common synthetic nurse profile used in these scenarios."""
    return {"skills": skills or ["mentoring"], "interests": ["education"],
            "availability": availability or ["weekday_morning"], "recommendations_opt_in": opt_in}


def test_profile_opt_in_eligibility_and_feedback_ownership(client):
    """Require a profile and opt-in, then protect results and their feedback."""
    assert client.post("/api/v1/recommendations", json={}, headers=headers()).status_code == 404
    assert client.put("/api/v1/profile", json=profile(False), headers=headers()).status_code == 201
    assert client.post("/api/v1/recommendations", json={}, headers=headers()).status_code == 403
    assert client.put("/api/v1/profile", json=profile(), headers=headers()).status_code == 200
    result = client.post("/api/v1/recommendations", json={"limit": 5}, headers=headers())
    assert result.status_code == 200
    items = result.json()["items"]
    assert len(items) == 1
    assert items[0]["opportunity"]["title"] == "Nurse mentoring committee"
    rec_id = items[0]["id"]
    assert client.post(f"/api/v1/recommendations/{rec_id}/feedback", json={"rating": "declined"}, headers=headers()).status_code == 201
    assert client.post(f"/api/v1/recommendations/{rec_id}/feedback", json={"rating": "helpful"}, headers=headers("nurse2")).status_code == 404
    result = client.post("/api/v1/navigator/messages", json={"message": "Why?", "recommendation_id": rec_id}, headers=headers())
    assert result.json()["answer"] == items[0]["explanation"]
    assert client.put("/api/v1/profile", json=profile(False), headers=headers()).status_code == 200
    assert client.post("/api/v1/navigator/messages", json={"message": "Why?", "recommendation_id": rec_id}, headers=headers()).status_code == 403


def test_schedule_empty_requirements_and_open_status(client):
    """Exercise unrestricted schedules and role-based listing visibility."""
    assert client.put("/api/v1/profile", json=profile(skills=["pediatric nursing"], availability=["night"]), headers=headers()).status_code == 201
    result = client.post("/api/v1/recommendations", json={}, headers=headers()).json()
    assert [item["opportunity"]["title"] for item in result["items"]] == ["Pediatric education project"]
    payload = {"title": "Closed", "description": "Hidden", "category": "project", "required_skills": [],
               "interests": [], "availability": [], "status": "closed"}
    assert client.post("/api/v1/opportunities", json=payload, headers=headers()).status_code == 403
    assert client.post("/api/v1/opportunities", json=payload, headers=headers("admin")).status_code == 201
    assert all(item["title"] != "Closed" for item in client.get("/api/v1/opportunities", headers=headers()).json()["items"])


def test_single_opportunity_visibility(client):
    """Hide closed listings from nurses while allowing administrators to view them."""
    payload = {"title": "Closed", "description": "Hidden", "category": "project", "required_skills": [],
               "interests": [], "availability": [], "status": "closed"}
    created = client.post("/api/v1/opportunities", json=payload, headers=headers("admin"))
    assert created.status_code == 201
    closed_path = f"/api/v1/opportunities/{created.json()['id']}"
    assert client.get(closed_path, headers=headers()).status_code == 404
    assert client.get(closed_path, headers=headers("admin")).json()["status"] == "closed"

    open_path = "/api/v1/opportunities/10000000-0000-4000-8000-000000000001"
    assert client.get(open_path, headers=headers()).json()["status"] == "open"
    missing_path = f"/api/v1/opportunities/{uuid4()}"
    for user in ("nurse", "admin"):
        assert client.get(missing_path, headers=headers(user)).status_code == 404


def test_recommendations_order_and_limit(client, monkeypatch):
    """Rank by score, then title and ID, before applying the requested limit."""
    nurse_profile = {**profile(), "skills": ["MENTORING"], "interests": ["Education", "Leadership"]}
    assert client.put("/api/v1/profile", json=nurse_profile, headers=headers()).status_code == 201

    ids = iter(UUID(value) for value in (
        "20000000-0000-4000-8000-000000000001",
        "20000000-0000-4000-8000-000000000003",
        "20000000-0000-4000-8000-000000000002",
    ))
    monkeypatch.setattr("app.routers.opportunities.uuid4", lambda: next(ids))
    base = {"description": "Synthetic listing", "category": "project", "required_skills": ["mentoring"],
            "interests": ["education"], "availability": [], "status": "open"}
    created = []
    for title, interests in (
        ("Z high score", ["education", "leadership"]),
        ("Alpha match", ["education"]),
        ("Alpha match", ["education"]),
    ):
        response = client.post("/api/v1/opportunities", json={**base, "title": title, "interests": interests},
                               headers=headers("admin"))
        assert response.status_code == 201
        created.append(response.json()["id"])

    response = client.post("/api/v1/recommendations", json={"limit": 4}, headers=headers())
    assert response.status_code == 200
    items = response.json()["items"]
    expected_ids = [created[0], *sorted(created[1:]), "10000000-0000-4000-8000-000000000001"]
    assert [item["opportunity"]["id"] for item in items] == expected_ids
    assert [item["rank"] for item in items] == [1, 2, 3, 4]

    limited = client.post("/api/v1/recommendations", json={"limit": 2}, headers=headers())
    assert limited.status_code == 200
    assert [item["opportunity"]["id"] for item in limited.json()["items"]] == expected_ids[:2]


def test_support_response_and_authorization(client):
    """Check support ownership, administrator transitions, and required response."""
    created = client.post("/api/v1/support-requests", json={"subject": "Question", "description": "Please help."}, headers=headers())
    assert created.status_code == 201
    path = "/api/v1/support-requests/" + created.json()["id"]
    assert client.get(path, headers=headers("nurse2")).status_code == 404
    assert client.patch(path, json={"status": "in_review"}, headers=headers()).status_code == 403
    assert client.patch(path, json={"status": "closed"}, headers=headers("admin")).status_code == 422
    assert client.patch(path, json={"status": "in_review"}, headers=headers("admin")).status_code == 200
    response = client.patch(path, json={"status": "closed", "response": "Please update your availability."}, headers=headers("admin"))
    assert response.status_code == 200
    assert client.get(path, headers=headers()).json()["response"] == "Please update your availability."
    assert client.patch(path, json={"status": "closed", "response": "Again"}, headers=headers("admin")).status_code == 409


def test_validation_identity_and_no_implicit_escalation(client):
    """Reject invalid requests and ensure chat does not silently request support."""
    assert client.get("/api/v1/opportunities").status_code == 401
    invalid = client.put("/api/v1/profile", json={**profile(), "unknown": 1}, headers=headers())
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "VALIDATION_ERROR"
    assert client.post("/api/v1/support-requests", json={"subject": " ", "description": "Test"}, headers=headers()).status_code == 422
    answer = client.post("/api/v1/navigator/messages", json={"message": "Something complex"}, headers=headers()).json()
    assert answer["escalation_suggested"] is True
    assert client.get("/api/v1/support-requests", headers=headers()).json()["items"] == []


def test_audit_omits_profile_and_support_contents(client):
    """Check that the audit records do not contain the submitted support text."""
    client.put("/api/v1/profile", json=profile(), headers=headers())
    client.post("/api/v1/support-requests", json={"subject": "Private", "description": "Do not log this text"}, headers=headers())
    with Session(database.get_engine()) as session:
        events = session.scalars(select(database.AuditEvent)).all()
        assert {event.event for event in events} >= {"profile.updated", "support.created"}
        assert all("Do not log this text" not in repr(event.__dict__) for event in events)
