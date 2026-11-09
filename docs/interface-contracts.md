# GoNurse Interface Contracts

**Status:** Draft for team review  
**Purpose:** Describe how the React interface is expected to communicate with GoNurse through the FastAPI API.

> **Important:** The routes, fields, response examples, and status codes below are proposed. Confirm them with the backend developer before treating them as final. Use synthetic data only. Do not include real patient or employee information.

## General Rules

- Requests and responses use JSON unless the endpoint returns an error.
- The prototype’s demo identity is not real authentication.
- The demo user is selected with the `X-Demo-User` header: `nurse`, `nurse2`, or `admin`.
- A nurse may access only their own profile and support requests.
- A nurse must opt in before generating or viewing recommendations.
- The endpoint paths below must be checked against the backend.

## Nurse Profile

### Get the nurse profile

`GET /api/profiles/me`

Returns the current nurse’s skills, interests, availability, and recommendation opt-in status.

Example response (`200 OK`):

```json
{
  "skills": ["mentoring"],
  "interests": ["professional development"],
  "availability": ["weekday_morning"],
  "recommendation_opt_in": true
}
```

### Update the nurse profile

`PUT /api/profiles/me`

Example request:

```json
{
  "skills": ["mentoring"],
  "interests": ["professional development"],
  "availability": ["weekday_morning"],
  "recommendation_opt_in": true
}
```

Validation:

- `skills`, `interests`, and `availability` must be lists of text values.
- `recommendation_opt_in` must be `true` or `false`.
- An empty list is allowed.

Example response (`200 OK`):

```json
{
  "skills": ["mentoring"],
  "interests": ["professional development"],
  "availability": ["weekday_morning"],
  "recommendation_opt_in": true
}
```

## Opportunities

### List opportunities

`GET /api/opportunities`

Returns available opportunities and their required skills and availability.

Example response (`200 OK`):

```json
{
  "opportunities": [
    {
      "opportunity_id": "example-id",
      "title": "Mentor",
      "description": "Support nurses who are developing mentoring skills.",
      "required_skills": ["mentoring"],
      "availability": ["weekday_morning"]
    }
  ]
}
```

### Create an opportunity

`POST /api/admin/opportunities`

For administrator use.

Example request:

```json
{
  "title": "Mentor",
  "description": "Support nurses who are developing mentoring skills.",
  "required_skills": ["mentoring"],
  "availability": ["weekday_morning"]
}
```

Validation:

- `title` and `description` must not be empty.
- `required_skills` and `availability` must be lists of text values.
- An empty `required_skills` list means no skills are required.
- An empty `availability` list means there is no schedule restriction.

Example response (`201 Created`):

```json
{
  "opportunity_id": "example-id",
  "title": "Mentor",
  "description": "Support nurses who are developing mentoring skills.",
  "required_skills": ["mentoring"],
  "availability": ["weekday_morning"]
}
```

## Recommendations

### Get recommendations

`GET /api/recommendations`

Returns ranked opportunities with an explanation for each match. The nurse must opt in before recommendations are generated or explained.

Example response (`200 OK`):

```json
{
  "recommendations": [
    {
      "recommendation_id": "example-recommendation-id",
      "opportunity_id": "example-opportunity-id",
      "title": "Mentor",
      "explanation": "Your skills and availability match this opportunity."
    }
  ]
}
```

If the nurse has not opted in, the API should deny the request. The exact status code and error response must be confirmed with the backend developer.

### Submit feedback

`POST /api/recommendations/{recommendation_id}/feedback`

Example request:

```json
{
  "decision": "accepted"
}
```

Allowed decisions: `accepted` or `declined`.

Declining records feedback but does not hide the opportunity from future recommendations.

Example response (`200 OK`):

```json
{
  "recommendation_id": "example-recommendation-id",
  "decision": "accepted",
  "message": "Feedback recorded."
}
```

## Career Navigator

### Send a message

`POST /api/career-navigator/messages`

Example request:

```json
{
  "message": "Why was this opportunity recommended?",
  "recommendation_id": "example-recommendation-id"
}
```

`recommendation_id` is optional. When included, it identifies the recommendation the nurse is asking about.

Example response (`200 OK`):

```json
{
  "answer": "Your mentoring skills matched the opportunity.",
  "suggest_human_support": false
}
```

Validation:

- `message` must not be empty.
- `recommendation_id` is optional.
- If the Career Navigator cannot help, it may suggest human support. It must not create a support request automatically.

**Prototype limitation:** The Career Navigator currently uses deterministic rules. It is not an AI model.

## Support Requests

### Create a support request

`POST /api/support-requests`

Creates a support request initiated by the nurse.

Example request:

```json
{
  "subject": "Question about an opportunity",
  "message": "I would like more information about the mentoring opportunity."
}
```

Validation:

- `subject` and `message` must not be empty.

Example response (`201 Created`):

```json
{
  "request_id": "example-request-id",
  "subject": "Question about an opportunity",
  "message": "I would like more information about the mentoring opportunity.",
  "status": "open",
  "admin_response": null
}
```

### List support requests

`GET /api/support-requests`

Returns the requesting nurse’s own support requests and any administrator response.

Example response (`200 OK`):

```json
{
  "support_requests": [
    {
      "request_id": "example-request-id",
      "subject": "Question about an opportunity",
      "message": "I would like more information about the mentoring opportunity.",
      "status": "open",
      "admin_response": null
    }
  ]
}
```

### Respond to a support request

`PATCH /api/admin/support-requests/{request_id}`

For administrator use. Adds or updates the response to a support request.

Example request:

```json
{
  "admin_response": "Please contact the opportunity coordinator for more information."
}
```

Example response (`200 OK`):

```json
{
  "request_id": "example-request-id",
  "admin_response": "Please contact the opportunity coordinator for more information."
}
```

## Errors

The following is a proposed error format. FastAPI may return a different format, especially for validation errors. Confirm the actual response with the backend developer.

Example:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Check the submitted information."
  }
}
```

Proposed status codes:

- `400` — The request could not be processed.
- `403` — The user is not allowed to perform the action, or recommendation opt-in is required.
- `404` — The requested item was not found.
- `422` — Submitted values failed validation.
- `500` — Unexpected server error.

The interface should show a clear message when a request fails and should not display sensitive information from server errors.

## Items for Team Confirmation

- Confirm all endpoint paths and HTTP methods against the backend.
- Confirm request fields, response fields, and status codes.
- Confirm the support request fields and response format.
- Confirm how the backend represents validation and other errors.
- Confirm that recommendation opt-in is required for recommendation and explanation requests.
- Update these examples if the backend uses different names or formats.
