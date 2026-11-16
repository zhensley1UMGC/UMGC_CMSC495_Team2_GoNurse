"""Exercise API behavior in isolation using a fresh in-memory database per test."""

import json
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import Session

from app import database
from app.main import ACTORS, app, build_navigator_context


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


def test_navigator_context_selects_nurse_data_and_open_listings(client):
    client.put("/api/v1/profile", json=profile(), headers=headers())
    client.put("/api/v1/profile", json=profile(skills=["other nurse private skill"]), headers=headers("nurse2"))
    with Session(database.get_engine()) as session:
        session.add(database.Opportunity(
            id=str(uuid4()), title="Hidden", description="Closed listing", category="project",
            required_skills=[], interests=[], availability=[], status="closed",
        ))
        session.commit()
        context = build_navigator_context(session, ACTORS["nurse"])

    assert context["profile"] == {
        "skills": ["mentoring"], "interests": ["education"], "availability": ["weekday_morning"],
    }
    assert len(context["current_opportunities"]) == 2
    assert all(set(item) == {"id", "title", "description", "category", "required_skills",
                             "interests", "availability"} for item in context["current_opportunities"])
    assert context["recommendation"] is None
    serialized = json.dumps(context)
    assert "other nurse private skill" not in serialized
    assert "Closed listing" not in serialized


def test_navigator_context_recommendation_ownership_opt_in_and_visibility(client):
    client.put("/api/v1/profile", json=profile(), headers=headers())
    client.put("/api/v1/profile", json=profile(), headers=headers("nurse2"))
    rec = client.post("/api/v1/recommendations", json={}, headers=headers()).json()["items"][0]
    rec_id = UUID(rec["id"])
    with Session(database.get_engine()) as session:
        stored = session.get(database.Recommendation, str(rec_id))
        stored.opportunity_snapshot = {**stored.opportunity_snapshot, "private_extra": "not for model"}
        session.commit()
        context = build_navigator_context(session, ACTORS["nurse"], rec_id)
        assert context["recommendation"]["id"] == rec["id"]
        assert context["recommendation"]["opportunity_at_generation"]["id"] == rec["opportunity"]["id"]
        assert context["recommendation"]["explanation"] == rec["explanation"]
        assert sum(item["id"] == rec["opportunity"]["id"] for item in context["current_opportunities"]) == 1
        assert "not for model" not in json.dumps(context)
        with pytest.raises(HTTPException) as foreign:
            build_navigator_context(session, ACTORS["nurse2"], rec_id)
        assert foreign.value.status_code == 404
        with pytest.raises(HTTPException) as missing:
            build_navigator_context(session, ACTORS["nurse"], uuid4())
        assert missing.value.status_code == 404
        item = session.get(database.Opportunity, rec["opportunity"]["id"])
        item.status = "closed"
        session.commit()
        with pytest.raises(HTTPException) as closed:
            build_navigator_context(session, ACTORS["nurse"], rec_id)
        assert closed.value.status_code == 404
        session.delete(item)
        session.commit()
        with pytest.raises(HTTPException) as deleted:
            build_navigator_context(session, ACTORS["nurse"], rec_id)
        assert deleted.value.status_code == 404

    client.put("/api/v1/profile", json=profile(False), headers=headers())
    with Session(database.get_engine()) as session:
        assert build_navigator_context(session, ACTORS["nurse"])["recommendation"] is None
        with pytest.raises(HTTPException) as opted_out:
            build_navigator_context(session, ACTORS["nurse"], rec_id)
        assert opted_out.value.status_code == 403
        with pytest.raises(HTTPException) as missing_profile:
            build_navigator_context(session, (str(uuid4()), "nurse"))
        assert missing_profile.value.status_code == 404
        with pytest.raises(HTTPException) as admin:
            build_navigator_context(session, ACTORS["admin"])
        assert admin.value.status_code == 403


def test_navigator_context_distinguishes_current_listing_from_recommendation_snapshot(client):
    client.put("/api/v1/profile", json=profile(), headers=headers())
    rec = client.post("/api/v1/recommendations", json={}, headers=headers()).json()["items"][0]
    original = rec["opportunity"]
    updated = {key: original[key] for key in (
        "title", "description", "category", "required_skills", "interests", "availability", "status",
    )}
    updated["title"] = "Updated mentoring committee"
    response = client.put(f"/api/v1/opportunities/{original['id']}", json=updated, headers=headers("admin"))
    assert response.status_code == 200

    with Session(database.get_engine()) as session:
        context = build_navigator_context(session, ACTORS["nurse"], UUID(rec["id"]))

    current = next(item for item in context["current_opportunities"] if item["id"] == original["id"])
    snapshot = context["recommendation"]["opportunity_at_generation"]
    assert current["title"] == "Updated mentoring committee"
    assert snapshot["id"] == current["id"]
    assert snapshot["title"] == original["title"]


def test_navigator_context_includes_referenced_listing_outside_first_page(client):
    client.put("/api/v1/profile", json=profile(), headers=headers())
    rec = client.post("/api/v1/recommendations", json={}, headers=headers()).json()["items"][0]
    with Session(database.get_engine()) as session:
        session.add_all([
            database.Opportunity(
                id=str(uuid4()), title=f"Earlier {i:02}", description="Open", category="project",
                required_skills=[], interests=[], availability=[], status="open",
            )
            for i in range(20)
        ])
        session.commit()
        context = build_navigator_context(session, ACTORS["nurse"], UUID(rec["id"]))
        assert len(context["current_opportunities"]) == 21
        assert rec["opportunity"]["id"] in {item["id"] for item in context["current_opportunities"]}
