# GoNurse Interface Contracts

**Status:** Implemented local prototype baseline; team Alpha approval pending  
**Reviewed:** November 15, 2026  
**Purpose:** Define the JSON interface used by the React client and FastAPI backend.

This revision replaces the earlier proposed routes and payloads with the
implementation inspected in [backend endpoints and schemas](../Prototype/backend/app/main.py),
[persistence models](../Prototype/backend/app/database.py), and
[React client](../Prototype/frontend/src/main.jsx). The November 15 review
describes the inspected prototype baseline. Recheck the implementation against
the actual Alpha commit before submission.

For project design context, see the
[Unit 3 system design specification](./Unit%203%20Assignment%20-%20System%20Design%20Specification.docx).
Planned Alpha changes are identified at the end of this document; they are not
implemented capabilities. Use synthetic data only.

## 1. Transport, identity, and common rules

- API prefix: `/api/v1`. All endpoint paths below include this prefix.
- Local backend: `http://127.0.0.1:8000`; interactive API docs: `/docs`;
  generated OpenAPI: `/openapi.json`. The prototype uses local HTTP.
- Send JSON bodies with `Content-Type: application/json`. Handled application
  and validation errors also return JSON. Clients must handle non-JSON network,
  proxy, or routing failures without assuming the application error envelope.
- Every application endpoint requires `X-Demo-User: nurse`, `nurse2`, or `admin`.
  A missing/unknown value returns `401`. Headers are client-selectable demo
  identities, **not authentication**. Keep the prototype local; do not use real
  patient/employee data or rely on it for real-user security.
- Nurse-only operations are profile read/write, recommendation generation,
  feedback, Navigator, and support creation. Admin-only operations are
  opportunity creation/replacement and support status updates. Both roles can
  browse permitted opportunities and support records.
- IDs are UUID strings. Invalid UUID path/body values return `422`; a
  well-formed ID that is missing or hidden by ownership/visibility returns `404`.
- Timestamps are ISO 8601 strings; application timestamps originate in UTC.
  Clients should parse them as dates rather than depend on a particular `Z`
  versus `+00:00` representation.
- Request bodies reject unknown fields. All fields are required unless a default
  or optional value is documented. Send JSON booleans and numbers rather than
  relying on Pydantic's non-strict type coercion.
- Text fields are stripped of surrounding whitespace and reject blank values.
  String-array entries reject whitespace-only labels; comparison trims and
  case-folds labels. Arrays may be empty and contain at most 100 entries.
  Availability labels remain free-form strings, not a controlled enum.
- `PUT` replaces all editable fields; it is not a partial update. Omit
  server-managed fields such as IDs and timestamps from write bodies.
- Browser CORS allows `http://localhost:5173` and `http://127.0.0.1:5173`, methods
  `GET`, `POST`, `PUT`, `PATCH`, and headers `Content-Type`, `X-Demo-User`.

## 2. Endpoint summary

| Method and path | Role | Success |
|---|---|---|
| `GET /api/v1/profile` | Nurse | `200` profile; `404` before first save |
| `PUT /api/v1/profile` | Nurse | `201` on creation; `200` on replacement |
| `GET /api/v1/opportunities` | Either | `200` paginated list |
| `GET /api/v1/opportunities/{opportunity_id}` | Either | `200` visible opportunity |
| `POST /api/v1/opportunities` | Admin | `201` created opportunity |
| `PUT /api/v1/opportunities/{opportunity_id}` | Admin | `200` replaced opportunity |
| `POST /api/v1/recommendations` | Nurse | `200` generated result set |
| `POST /api/v1/recommendations/{recommendation_id}/feedback` | Nurse owner | `201` feedback |
| `POST /api/v1/navigator/messages` | Nurse | `200` reply |
| `POST /api/v1/support-requests` | Nurse | `201` created support request |
| `GET /api/v1/support-requests` | Either | `200` role-filtered paginated list |
| `GET /api/v1/support-requests/{request_id}` | Nurse owner or admin | `200` support request |
| `PATCH /api/v1/support-requests/{request_id}` | Admin | `200` updated support request |

There are no separate `/admin` routes or implemented `GET /recommendations`
route. Recommendation generation is a state-changing `POST` that stores results.

## 3. Nurse profile

`GET /api/v1/profile` returns the selected nurse's profile. A new nurse has no
saved profile, so the endpoint returns `404`; the client initializes an empty
form with opt-in off. An administrator receives `403`.

`PUT /api/v1/profile` creates or replaces the selected nurse's profile.
All four fields are required:

```json
{
  "skills": ["mentoring"],
  "interests": ["education"],
  "availability": ["weekday_morning"],
  "recommendations_opt_in": true
}
```

Response (`201` when first saved, otherwise `200`):

```json
{
  "id": "00000000-0000-4000-8000-000000000001",
  "skills": ["mentoring"],
  "interests": ["education"],
  "availability": ["weekday_morning"],
  "recommendations_opt_in": true,
  "updated_at": "2026-11-15T17:00:00Z"
}
```

Use the plural field `recommendations_opt_in`. Saving a profile does not generate
recommendations. Setting it to `false` blocks subsequent generation and
Navigator explanations of saved recommendations. It does not delete saved
results, revoke already delivered client data, or currently block feedback.

## 4. Opportunities

### List and detail

`GET /api/v1/opportunities?limit=20&offset=0` returns:

```json
{
  "items": [
    {
      "id": "10000000-0000-4000-8000-000000000001",
      "title": "Nurse mentoring committee",
      "description": "Help develop a mentoring program.",
      "category": "committee",
      "required_skills": ["mentoring"],
      "interests": ["education"],
      "availability": ["weekday_morning"],
      "status": "open",
      "updated_at": "2026-11-15T17:00:00Z"
    }
  ],
  "limit": 20,
  "offset": 0
}
```

`limit` defaults to 20 and must be 1–100; `offset` defaults to 0 and must be
nonnegative. Results sort by title then ID. There is no total-count field.
Nurses see only open opportunities; administrators see open and closed ones.
`GET /api/v1/opportunities/{opportunity_id}` returns one object with the same
fields; a closed opportunity is hidden from nurses with `404`.

### Create and replace

`POST /api/v1/opportunities` and
`PUT /api/v1/opportunities/{opportunity_id}` require admin identity and all
fields below:

```json
{
  "title": "Nurse mentoring committee",
  "description": "Help develop a mentoring program.",
  "category": "committee",
  "required_skills": ["mentoring"],
  "interests": ["education"],
  "availability": ["weekday_morning"],
  "status": "open"
}
```

- `title`: nonblank, at most 200 characters.
- `description`: nonblank, at most 2,000 characters.
- `category`: `project`, `committee`, `mentoring`, or `professional_development`.
- `status`: `open` or `closed`.
- `required_skills`, `interests`, `availability`: string arrays, at most 100
  entries each. Empty required skills mean no skills are mandatory; empty
  availability means no schedule restriction.

Both return the full opportunity object, including `id` and `updated_at`;
creation returns `201`, replacement `200`. Closing a listing excludes it from
future generation and nurse browsing. Stored recommendation snapshots retain
the listing's previous state. Reopening via full replacement is supported.

## 5. Recommendations and feedback

### Generate recommendations

`POST /api/v1/recommendations` requires a saved nurse profile and current opt-in.
Send a JSON object; `{}` uses the default limit of 5. Explicit request:

```json
{
  "limit": 5
}
```

`limit` must be 1–20. Success (`200`):

```json
{
  "items": [
    {
      "id": "20000000-0000-4000-8000-000000000001",
      "opportunity": {
        "id": "10000000-0000-4000-8000-000000000001",
        "title": "Nurse mentoring committee",
        "description": "Help develop a mentoring program.",
        "category": "committee",
        "required_skills": ["mentoring"],
        "interests": ["education"],
        "availability": ["weekday_morning"],
        "status": "open",
        "updated_at": "2026-11-15T17:00:00Z"
      },
      "rank": 1,
      "explanation": "Eligible; matched 1 required skills and 1 interests."
    }
  ],
  "generated_at": "2026-11-15T17:05:00Z"
}
```

- Missing profile: `404`. Saved profile with opt-in off: `403`.
- Only open opportunities are considered. Every required skill must match after
  trimming/case-folding. A listing with availability labels requires at least
  one matching nurse label; an empty nurse availability does not satisfy a
  restricted listing.
- Current ranking is **deterministic, not AI**: matched required-skill count plus
  matched-interest count, descending; ties use case-folded title then ID.
- `rank` starts at 1. `opportunity` is a stored snapshot, not a live lookup.
  Every generation stores a new result set and new IDs; it is not idempotent.
- No matches is a successful `items: []` response with `generated_at`.
  A service failure is an error, not an empty success.

### Record feedback

`POST /api/v1/recommendations/{recommendation_id}/feedback`:

```json
{
  "rating": "declined",
  "comment": "This opportunity does not suit my current goals."
}
```

`rating` is required: `helpful`, `not_helpful`, or `declined`. `comment` is
optional, defaults to `null`, and must be nonblank and at most 2,000 characters
when supplied as text. Response (`201`):

```json
{
  "id": "30000000-0000-4000-8000-000000000001",
  "recommendation_id": "20000000-0000-4000-8000-000000000001",
  "rating": "declined",
  "comment": "This opportunity does not suit my current goals.",
  "created_at": "2026-11-15T17:06:00Z"
}
```

Only the result's nurse owner may submit feedback; another nurse receives `404`
and an administrator `403`. Feedback does not change rankings or hide listings.
Repeated submissions create separate records. The API does not accept a
`decision` field or `accepted` rating. Opt-out is a profile update, not feedback.

## 6. Career Navigator

`POST /api/v1/navigator/messages`:

```json
{
  "message": "Why was this recommended?",
  "recommendation_id": "20000000-0000-4000-8000-000000000001"
}
```

`message` is required, nonblank, at most 2,000 characters.
`recommendation_id` is an optional UUID, default `null`. Response (`200`):

```json
{
  "answer": "Eligible; matched 1 required skills and 1 interests.",
  "referenced_opportunity_ids": ["10000000-0000-4000-8000-000000000001"],
  "escalation_suggested": false
}
```

When a recommendation ID is supplied, the backend requires a saved profile,
current opt-in, and ownership, then returns the stored explanation. With opt-in
off this returns `403`; another nurse's result is hidden with `404` after the
profile/opt-in checks.

Without a recommendation ID, the rule-based Navigator can explain profile
editing or list up to five open opportunities without requiring a profile or
opt-in. Unsupported questions return a clear limitation with
`escalation_suggested: true`. It never creates a support request automatically.
Both Navigator and matching currently use fixed rules, not an AI model.

## 7. Support requests

### Create, list, and view

`POST /api/v1/support-requests` requires nurse identity:

```json
{
  "subject": "Question about an opportunity",
  "description": "Please explain the mentoring committee schedule."
}
```

`subject` is required, nonblank, at most 200 characters. `description` is
required, nonblank, at most 2,000 characters. Response (`201`):

```json
{
  "id": "40000000-0000-4000-8000-000000000001",
  "subject": "Question about an opportunity",
  "description": "Please explain the mentoring committee schedule.",
  "status": "open",
  "response": null,
  "created_at": "2026-11-15T17:10:00Z",
  "updated_at": "2026-11-15T17:10:00Z"
}
```

`GET /api/v1/support-requests?status=open&limit=20&offset=0` returns
`{ "items": [supportRequest], "limit": 20, "offset": 0 }`, where
`supportRequest` denotes the object above. Nurses receive only their own
requests; admins receive all. Optional `status` accepts `open`, `in_review`, or
`closed`; omit it to list all visible statuses. Pagination uses the same bounds
as opportunities. Results sort newest first by creation time; ties have no
explicit secondary ordering.

`GET /api/v1/support-requests/{request_id}` returns the full object to the nurse
owner or an administrator (`200`); missing/other-nurse records return `404`.
A profile or recommendation opt-in is not required for support.

### Administrator status update and response

`PATCH /api/v1/support-requests/{request_id}` requires admin identity. To mark
in review, send `{ "status": "in_review" }`. To close with a response:

```json
{
  "status": "closed",
  "response": "Please contact the committee coordinator to discuss the schedule."
}
```

- `status` is required and accepts only `in_review` or `closed`.
- `response` is optional/nullable for `in_review`; when supplied as text it must
  be nonblank and at most 2,000 characters. Closing requires a nonblank response
  in that request, even if a response was saved previously.
- Allowed transitions: `open → in_review`, `open → closed`,
  `in_review → closed`. Repeating the current state or changing a closed request
  returns `409`. Reopening and response-only edits are not supported.
- Omitting or passing `null` for a response during an allowed transition leaves
  any stored response unchanged. A supplied nonblank response replaces it.
- Success returns the **full support object** (`200`), with new status, response,
  and `updated_at`. The nurse sees the response on subsequent reads.

## 8. Errors and client handling

The backend's registered HTTP, validation, and unexpected-error handlers use:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more fields are invalid.",
    "details": [
      {
        "field": "body.recommendations_opt_in",
        "message": "Field required"
      }
    ],
    "request_id": "50000000-0000-4000-8000-000000000001"
  }
}
```

Field-validation errors use `VALIDATION_ERROR`; locations can include `body`,
`path`, or `query`. Explicit endpoint errors use `HTTP_<status>` and an empty
`details` array, including the business-rule `422` for closing without a
response. Unexpected errors use `INTERNAL_ERROR` with a generic message and no
stack trace or submitted content. `request_id` is generated per error response;
it is not a documented end-to-end tracing facility.

| Status | Implemented meaning |
|---|---|
| `401` | Missing or unknown demo identity |
| `403` | Wrong role, or opt-in required for generation/recommendation explanation |
| `404` | Missing profile/resource or resource hidden by ownership/visibility |
| `409` | Invalid support status transition |
| `422` | Body/path/query validation, malformed JSON, unknown fields, or missing closing response |
| `500` | Unexpected application/dependency error |

The prototype has no implemented rate limit (`429`) or dedicated unavailable-AI
response (`503`). Framework routing errors may use a different JSON format.
Clients should check HTTP status, use `error.message` when present, provide a
safe fallback for other failures, and never render raw internal error content.
Do not automatically retry creation/generation/feedback requests: retries can
create duplicate records. Hide or clear sensitive identity-specific views on
identity changes; clear recommendation views after opt-out as an Alpha UI
requirement, since server-side opt-out cannot retract data already delivered.

## 9. Contract verification and Alpha decisions

### Evidence from this review

- Inspected endpoint decorators, Pydantic inputs, returned fields, permission
  checks, database models, and React requests against the examples above.
- Ran [the existing API tests](../Prototype/backend/tests/test_api.py): **5 passed**
  using isolated SQLite. These cover profile/opt-in, eligibility, feedback
  ownership, support transitions, validation, and no implicit support creation.
  This is focused evidence, not exhaustive verification of every example.
- PostgreSQL runtime behavior and a real-model AI integration were not verified
  in this review. [The PostgreSQL test](../Prototype/backend/tests/test_postgres.py)
  requires a dedicated test database and must be run separately for release.
