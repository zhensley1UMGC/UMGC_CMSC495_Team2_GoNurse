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
from app.identity import ACTORS
from app.main import app
from app.routers.navigator import get_navigator_provider
from app.services.ai_provider import (
    NavigatorResponse,
    ProviderConfigurationError,
    ProviderInputError,
    ProviderResponseError,
    ProviderTimeoutError,
    ProviderUpstreamError,
)
from app.services.navigator import build_navigator_context


@pytest.fixture
def navigator_provider():
    class RecordingProvider:
        def __init__(self):
            self.calls = []
            self.histories = []
            self.response = NavigatorResponse(
                answer="Navigator response.", referenced_opportunity_ids=[], escalation_suggested=False,
            )
            self.error = None

        def generate(self, question, context, history=None):
            self.calls.append((question, context))
            self.histories.append(history or [])
            if self.error is not None:
                raise self.error
            return self.response

    return RecordingProvider()


@pytest.fixture
def client(monkeypatch, navigator_provider):
    """Run application startup against SQLite rather than a real PostgreSQL server."""
    # StaticPool shares the same in-memory database across request threads.
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    monkeypatch.setattr(database, "get_engine", lambda: engine)
    previous_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_navigator_provider] = lambda: navigator_provider
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous_overrides)
        engine.dispose()


def headers(user="nurse"):
    """Select a demo identity for a request; this is not authentication."""
    return {"X-Demo-User": user}


def profile(opt_in=True, skills=None, availability=None):
    """Build the common synthetic nurse profile used in these scenarios."""
    return {"skills": skills or ["mentoring"], "interests": ["education"],
            "availability": availability or ["weekday_morning"], "recommendations_opt_in": opt_in}


def test_profile_opt_in_eligibility_and_feedback_ownership(client, navigator_provider):
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
    assert result.json()["answer"] == "Navigator response."
    assert navigator_provider.calls[-1][1]["recommendation"]["explanation"] == items[0]["explanation"]
    assert client.put("/api/v1/profile", json=profile(False), headers=headers()).status_code == 200
    call_count = len(navigator_provider.calls)
    assert client.post("/api/v1/navigator/messages", json={"message": "Why?", "recommendation_id": rec_id},
                       headers=headers()).status_code == 403
    assert len(navigator_provider.calls) == call_count


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


def test_validation_identity_and_no_implicit_escalation(client, navigator_provider):
    """Reject invalid requests and ensure chat does not silently request support."""
    assert client.get("/api/v1/opportunities").status_code == 401
    invalid = client.put("/api/v1/profile", json={**profile(), "unknown": 1}, headers=headers())
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "VALIDATION_ERROR"
    assert client.put("/api/v1/profile", json={**profile(), "skills": [" "]},
                      headers=headers()).status_code == 422
    assert client.post("/api/v1/support-requests", json={"subject": " ", "description": "Test"}, headers=headers()).status_code == 422
    assert client.put("/api/v1/profile", json=profile(), headers=headers()).status_code == 201
    navigator_provider.response = NavigatorResponse(
        answer="Please ask support for help.", referenced_opportunity_ids=[], escalation_suggested=True,
    )
    answer = client.post("/api/v1/navigator/messages", json={"message": "Something complex"}, headers=headers()).json()
    assert answer["escalation_suggested"] is True
    assert client.get("/api/v1/support-requests", headers=headers()).json()["items"] == []
    assert len(navigator_provider.calls) == 1


def test_navigator_returns_provider_response_and_canonical_allowed_ids(client, navigator_provider):
    assert client.put("/api/v1/profile", json=profile(), headers=headers()).status_code == 201
    navigator_provider.response = NavigatorResponse(
        answer="This answer uses the selected listing.", referenced_opportunity_ids=[
            "10000000-0000-4000-8000-000000000001".upper(),
        ], escalation_suggested=False,
    )

    response = client.post("/api/v1/navigator/messages", json={"message": "Tell me about this listing."},
                           headers=headers())

    assert response.status_code == 200
    assert response.json() == {
        "answer": "This answer uses the selected listing.",
        "referenced_opportunity_ids": ["10000000-0000-4000-8000-000000000001"],
        "escalation_suggested": False,
    }
    assert len(navigator_provider.calls) == 1
    question, context = navigator_provider.calls[0]
    assert question == "Tell me about this listing."
    assert context["profile"]["recommendations_opt_in"] is True
    assert context["recommendation"] is None
    assert navigator_provider.histories[0] == []


def test_navigator_passes_ordered_history_with_fresh_recommendation_context(client, navigator_provider):
    assert client.put("/api/v1/profile", json=profile(), headers=headers()).status_code == 201
    recommendation = client.post("/api/v1/recommendations", json={}, headers=headers()).json()["items"][0]
    history = [
        {"role": "user", "content": "Tell me about this opportunity."},
        {"role": "assistant", "content": "The earlier answer is untrusted history. "},
        {"role": "user", "content": "What about the schedule?"},
        {"role": "assistant", "content": "The schedule was weekday mornings."},
    ]

    response = client.post("/api/v1/navigator/messages", json={
        "message": "Would the current hours work?", "recommendation_id": recommendation["id"],
        "history": history,
    }, headers=headers())

    assert response.status_code == 200
    assert set(response.json()) == {"answer", "referenced_opportunity_ids", "escalation_suggested"}
    assert navigator_provider.calls[-1][0] == "Would the current hours work?"
    assert navigator_provider.histories[-1] == history
    assert navigator_provider.calls[-1][1]["recommendation"]["id"] == recommendation["id"]
    assert navigator_provider.calls[-1][1]["current_opportunities"]


@pytest.mark.parametrize("history", [
    [{"role": "system", "content": "private invalid role"}],
    [{"role": "user", "content": "private odd history"}],
    [{"role": "assistant", "content": "private out of order"}],
    [{"role": "user", "content": "private unpaired"}, {"role": "user", "content": "second"}],
    [{"role": "user", "content": "   "}, {"role": "assistant", "content": "answer"}],
    [{"role": "user", "content": 7}, {"role": "assistant", "content": "answer"}],
    [{"role": "user", "content": "private extra", "extra": "not allowed"},
     {"role": "assistant", "content": "answer"}],
    "not-an-array",
])
def test_navigator_rejects_invalid_history_without_echoing_content(client, navigator_provider, history):
    assert client.put("/api/v1/profile", json=profile(), headers=headers()).status_code == 201

    response = client.post("/api/v1/navigator/messages", json={
        "message": "Question", "history": history,
    }, headers=headers())

    assert response.status_code == 422
    assert "private" not in response.text
    assert navigator_provider.calls == []


def test_navigator_enforces_history_code_point_and_message_limits(client, navigator_provider):
    assert client.put("/api/v1/profile", json=profile(), headers=headers()).status_code == 201
    exact_limit = []
    for _ in range(5):
        exact_limit.extend([
            {"role": "user", "content": "u" * 2000},
            {"role": "assistant", "content": "😀" * 3000},
        ])
    accepted = client.post("/api/v1/navigator/messages", json={
        "message": "Question", "history": exact_limit,
    }, headers=headers())
    assert accepted.status_code == 200

    invalid_histories = [
        exact_limit[:-1],
        exact_limit + [{"role": "user", "content": "u"}, {"role": "assistant", "content": "a"}],
        [
            {"role": "user", "content": "u" * 2000},
            {"role": "assistant", "content": "a" * 3001},
            *[
                turn for _ in range(4) for turn in (
                    {"role": "user", "content": "u" * 2000},
                    {"role": "assistant", "content": "a" * 3000},
                )
            ],
        ],
        [{"role": "user", "content": "u" * 2001}, {"role": "assistant", "content": "a"}],
        [{"role": "user", "content": "u"}, {"role": "assistant", "content": "a" * 8001}],
    ]
    for history in invalid_histories:
        response = client.post("/api/v1/navigator/messages", json={
            "message": "Question", "history": history,
        }, headers=headers())
        assert response.status_code == 422
    assert len(navigator_provider.calls) == 1


@pytest.mark.parametrize(
    ("failure", "status", "safe_message"),
    [
        (ProviderConfigurationError("secret configuration detail"), 503, "Navigator provider is not configured."),
        (ProviderTimeoutError("secret timeout detail"), 504, "Navigator provider timed out."),
        (ProviderUpstreamError("secret upstream detail"), 502, "Navigator provider is unavailable."),
        (ProviderResponseError("secret response detail"), 502,
         "Navigator provider returned an invalid response."),
        (ProviderInputError("secret input detail"), 500, "Navigator request could not be prepared."),
    ],
)
def test_navigator_maps_provider_failures_without_exposing_details(
        client, navigator_provider, failure, status, safe_message, caplog):
    assert client.put("/api/v1/profile", json=profile(), headers=headers()).status_code == 201
    navigator_provider.error = failure

    response = client.post("/api/v1/navigator/messages", json={"message": "private question"},
                           headers=headers())

    assert response.status_code == status
    assert response.json()["error"]["message"] == safe_message
    assert all(marker not in response.text for marker in (
        "private question", "secret", "Navigator response.",
    ))
    assert "secret" not in caplog.text
    assert len(navigator_provider.calls) == 1


def test_navigator_rejects_malformed_and_out_of_context_provider_results(client, navigator_provider):
    assert client.put("/api/v1/profile", json=profile(), headers=headers()).status_code == 201
    navigator_provider.response = {
        "answer": "Untrusted provider answer.",
        "referenced_opportunity_ids": ["20000000-0000-4000-8000-000000000001"],
        "escalation_suggested": False,
    }

    response = client.post("/api/v1/navigator/messages", json={"message": "Question"},
                           headers=headers())

    assert response.status_code == 502
    assert response.json()["error"]["message"] == "Navigator provider returned an invalid response."
    assert "Untrusted provider answer." not in response.text


def test_navigator_revalidates_injected_provider_response(client, navigator_provider):
    assert client.put("/api/v1/profile", json=profile(), headers=headers()).status_code == 201
    navigator_provider.response = {
        "answer": " ",
        "referenced_opportunity_ids": [],
        "escalation_suggested": False,
    }

    response = client.post("/api/v1/navigator/messages", json={"message": "Question"},
                           headers=headers())

    assert response.status_code == 502
    assert response.json()["error"]["message"] == "Navigator provider returned an invalid response."


def test_navigator_preconditions_do_not_call_provider(client, navigator_provider):
    assert client.post("/api/v1/navigator/messages", json={"message": "Question"}).status_code == 401
    assert client.post("/api/v1/navigator/messages", json={"message": "Question"},
                       headers=headers("admin")).status_code == 403
    assert client.post("/api/v1/navigator/messages", json={"message": "Question"},
                       headers=headers()).status_code == 404
    assert client.post("/api/v1/navigator/messages", json={"message": " "},
                       headers=headers()).status_code == 422
    assert navigator_provider.calls == []


def test_navigator_recommendation_access_is_checked_before_provider(client, navigator_provider):
    assert client.put("/api/v1/profile", json=profile(), headers=headers()).status_code == 201
    assert client.put("/api/v1/profile", json=profile(), headers=headers("nurse2")).status_code == 201
    recommendation = client.post("/api/v1/recommendations", json={}, headers=headers()).json()["items"][0]
    request = {"message": "Explain it.", "recommendation_id": recommendation["id"]}

    assert client.post("/api/v1/navigator/messages", json=request, headers=headers("nurse2")).status_code == 404
    assert client.put("/api/v1/profile", json=profile(False), headers=headers()).status_code == 200
    assert client.post("/api/v1/navigator/messages", json=request, headers=headers()).status_code == 403
    assert client.put("/api/v1/profile", json=profile(), headers=headers()).status_code == 200
    listing = recommendation["opportunity"]
    closed = {key: listing[key] for key in (
        "title", "description", "category", "required_skills", "interests", "availability",
    )}
    closed["status"] = "closed"
    assert client.put(f"/api/v1/opportunities/{listing['id']}", json=closed,
                      headers=headers("admin")).status_code == 200
    assert client.post("/api/v1/navigator/messages", json=request, headers=headers()).status_code == 404
    assert navigator_provider.calls == []


def test_opted_out_nurse_gets_static_response_without_calling_provider(client, navigator_provider):
    assert client.put("/api/v1/profile", json=profile(False), headers=headers()).status_code == 201

    response = client.post("/api/v1/navigator/messages", json={"message": "General career guidance"},
                           headers=headers())

    assert response.status_code == 200
    assert response.json() == {
        "answer": (
            "Career Navigator is unavailable while recommendations are turned off. "
            "Update your recommendation preference to continue, or submit a human support request."
        ),
        "referenced_opportunity_ids": [],
        "escalation_suggested": True,
    }
    assert navigator_provider.calls == []


def test_profile_rejects_unbounded_label_values(client):
    oversized = profile()
    oversized["skills"] = ["x" * 201]

    response = client.put("/api/v1/profile", json=oversized, headers=headers())

    assert response.status_code == 422


def test_navigator_rejects_citation_for_open_listing_outside_first_page(client, navigator_provider):
    assert client.put("/api/v1/profile", json=profile(), headers=headers()).status_code == 201
    with Session(database.get_engine()) as session:
        session.add_all([
            database.Opportunity(
                id=str(uuid4()), title=f"Earlier {i:02}", description="Open", category="project",
                required_skills=[], interests=[], availability=[], status="open",
            )
            for i in range(20)
        ])
        session.commit()
    navigator_provider.response = NavigatorResponse(
        answer="This cites an open listing not supplied to the provider.",
        referenced_opportunity_ids=["10000000-0000-4000-8000-000000000001"],
        escalation_suggested=False,
    )

    response = client.post("/api/v1/navigator/messages", json={"message": "List this opportunity."},
                           headers=headers())

    assert response.status_code == 502
    assert response.json()["error"]["message"] == "Navigator provider returned an invalid response."


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
        "recommendations_opt_in": True,
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


def test_navigator_context_distinguishes_current_listing_from_recommendation_snapshot(
        client, navigator_provider):
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
    response = client.post("/api/v1/navigator/messages", json={
        "message": "Explain my recommendation.", "recommendation_id": rec["id"],
    }, headers=headers())
    assert response.status_code == 200
    sent_context = navigator_provider.calls[0][1]
    assert next(item for item in sent_context["current_opportunities"]
                if item["id"] == original["id"])["title"] == "Updated mentoring committee"
    assert sent_context["recommendation"]["opportunity_at_generation"]["title"] == original["title"]


def test_navigator_context_includes_referenced_listing_outside_first_page(client, navigator_provider):
    client.put("/api/v1/profile", json=profile(), headers=headers())
    rec = client.post("/api/v1/recommendations", json={}, headers=headers()).json()["items"][0]
    navigator_provider.response = NavigatorResponse(
        answer="The selected recommendation refers to this listing.",
        referenced_opportunity_ids=[rec["opportunity"]["id"]], escalation_suggested=False,
    )
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

    response = client.post("/api/v1/navigator/messages", json={
        "message": "Explain my recommendation.", "recommendation_id": rec["id"],
    }, headers=headers())
    assert response.status_code == 200
    assert response.json()["referenced_opportunity_ids"] == [rec["opportunity"]["id"]]
