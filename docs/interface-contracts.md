# GoNurse Interface Contracts

**Status:** Draft for team review  
**Purpose:** Define how the React interface communicates with GoNurse services through the FastAPI API.

## General Rules

- Requests and responses use JSON.
- Use synthetic data only. Do not send real patient or employee information.
- The prototype’s demo identity is not real authentication.
- The endpoint paths below are proposed and must be checked against the backend.

## Nurse Profile

### Get the nurse profile

`GET /api/profiles/me`

Returns the current nurse’s skills, interests, availability, and recommendation opt-in status.

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
