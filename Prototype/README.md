# GoNurse local prototype

An independent, synthetic-data demonstration of the proposed GoNurse workflow.
This is **not production software** and must not be used with patient records,
real employee information, or exposed to a network.

## What works

- React interface and FastAPI API for demo nurse and administrator roles.
- PostgreSQL storage for profiles, opportunities, recommendations, feedback,
  support requests, and minimal audit events.
- Explicit recommendation opt-in; required-skills and schedule filtering before
  deterministic ranking; explanations and feedback.
- An AI-backed Career Navigator that uses a configured provider for career
  guidance grounded in a nurse-scoped profile and bounded listing context.
  Unsupported or insufficiently supported questions can be escalated; suggesting
  support never submits a request automatically.
- Nurse-created support requests and administrator responses visible to the
  requesting nurse.

**AI limitation:** Career Navigator uses an OpenAI-compatible provider, but its
grounding is not guaranteed. The backend checks that cited opportunity IDs occur
in the supplied context; this does not verify that answer text is factually
supported. While opted in, model instructions cannot guarantee the recommendation
content policy. Matching and recommendation ranking remain deterministic and are
not AI-based. Embeddings, semantic search, and LangGraph are not implemented.

**Security limitation:** Demo identities are client-selected headers, not real
authentication. The service uses local HTTP, not production HTTPS. Authorization
checks demonstrate role and ownership logic only; no real users should rely on
them. No hospital or external customer database is connected. The sample data is
fabricated, and the system has not been validated for 10,000 users.

## Prerequisites

- Python with pip, Node.js with npm, and a running PostgreSQL server. The
  frontend test runner requires Node.js 22.12 or later on the 22.x line,
  Node.js 24.x, or Node.js 26 or later.
- An empty, dedicated PostgreSQL database for this prototype. The application
  creates its tables and inserts two synthetic opportunities on startup; it does
  not use or migrate existing databases.
- A local PostgreSQL connection string using the SQLAlchemy
  `postgresql+psycopg://` scheme. Provide credentials through your environment;
  do not commit them to files or share them in chats.

## Download the prototype

On the team's GitHub repository page, select **Code > Download ZIP** and extract
the archive, or clone the repository using the URL provided by GitHub. If the
repository is private, you will need access to it. Locate the `Prototype` folder
in the downloaded files; the commands below start from that folder.

## Set up Node.js on Windows

1. Download and install the LTS version of [Node.js](https://nodejs.org/).
   npm is included with Node.js.
2. Close and reopen PowerShell to pick up any PATH changes, then verify that
   both commands print a version:

   ```powershell
   node --version
   npm --version
   ```

If `npm` is not recognized, confirm Node.js is installed and reopen PowerShell.
If PowerShell reports that scripts are disabled, try `npm.cmd --version` instead;
use `npm.cmd install` and `npm.cmd run dev` for the frontend commands below.

## Set up PostgreSQL on Windows

If PostgreSQL is already installed and running, start at step 2.

1. Download and run the installer linked from the
   [PostgreSQL Windows download page](https://www.postgresql.org/download/windows/).
   Include PostgreSQL Server and pgAdmin 4. Set and securely save the password
   for the PostgreSQL administrator account (normally `postgres`). Keep the
   default port, `5432`, unless it is in use, and note the port you choose.
   Stack Builder and its optional add-ons are not needed for this prototype.
2. Open pgAdmin 4, expand **Servers**, and connect to your PostgreSQL server
   using the administrator password if prompted. Right-click **Databases**,
   select **Create > Database**, and create an empty database named
   `gonurse_prototype`.
3. Use the following format for your local connection URL, replacing
   `YOUR_PASSWORD` with your own password and changing the username or port
   if your setup differs:

   ```text
   postgresql+psycopg://postgres:YOUR_PASSWORD@localhost:5432/gonurse_prototype
   ```

   Characters with special meaning in a URL must be percent-encoded in the
   username and password. For example, `@` becomes `%40` and `%` becomes
   `%25`; see the
   [PostgreSQL connection URI documentation](https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING-URIS).
   Keep the completed URL private: it contains your password.

The application creates its own tables and two synthetic opportunities in the
dedicated database at startup. Do not point it at a hospital or other existing
database.

## Run on Windows

Open PowerShell and change to the `Prototype` folder inside your extracted or
cloned repository. For example, enter `cd ` followed by the folder's full
path in quotes. Then run:

```powershell
cd .\backend
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
# Set DATABASE_URL in this terminal to your own local PostgreSQL connection URL.
$env:DATABASE_URL = Read-Host 'Local PostgreSQL URL (postgresql+psycopg://...)'
.\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

`Read-Host` displays the URL as you enter it, including your password. Keep this backend terminal open while using the app.

Open a second PowerShell terminal, change to the same `Prototype` folder, and
run:

```powershell
cd .\frontend
npm install
npm run dev
```

Open the localhost URL printed by Vite. Choose Nurse 1, save an opted-in
profile with `mentoring` and `weekday_morning`, then generate recommendations.
Choose Administrator to create listings and respond to support requests.
For an alternative interface showing the same sections one at a time, open
`/tabbed.html` on that same localhost URL. The original grid interface remains
available at `/`; both interfaces share the view components in `frontend/src/views`,
the same local API, and demo data. Switching tabs keeps unfinished form drafts
while the page remains open.
The API documentation is available at `http://127.0.0.1:8000/docs`; API calls
require an `X-Demo-User` header of `nurse`, `nurse2`, or `admin`.

## Prototype rules and contract deviations

- Required skills are case-insensitive exact matches, and every listed required
  skill must be present. Empty required skills mean no skills are mandatory.
- When a listing specifies availability, at least one label must match the
  profile. A listing with no availability labels has no schedule restriction;
  an empty profile availability does not satisfy a fixed schedule. Labels are
  free-form pending team agreement.
- Feedback adds a `declined` value. Decline records feedback but does not hide
  future recommendations. Support requests include an administrator response,
  and nurses may list their own requests. These extend the rough contracts.
- Every Navigator question requires a saved nurse profile. A request may
  include `recommendation_id` to identify an existing recommendation; selecting
  one requires current opt-in, ownership, and an open listing. A missing profile
  returns 404. When recommendations are turned off, the Navigator returns a
  fixed response without calling the provider or sending profile/listing context.
  Opted-out nurses must turn recommendations on to use AI career guidance.
- The Navigator sends selected profile fields, including the opt-in preference,
  and up to 20 currently open listings to the configured provider. A referenced
  listing outside that first page is added when selected. The context labels
  current listings as `current_opportunities` and the saved recommendation
  listing as `opportunity_at_generation`; these can differ after an edit. The
  listing context is bounded and may not be a complete catalog. Only citations
  matching IDs in the current listing context are returned.
- Navigator requests may also include `history`, an ordered array of
  `{ "role": "user" | "assistant", "content": "..." }` turns. It is empty or
  contains complete alternating user/assistant exchanges, with at most 10
  previous messages and 25,000 Unicode code points total (excluding the new
  question). Each historical user message is limited to 2,000 code points and
  each assistant answer to 8,000. Invalid roles, incomplete exchanges, blank
  text, extra fields, and exceeded limits receive the normal 422 validation
  response.
- The browser keeps the full transcript in memory only. Reloading or closing
  the page clears it; identity changes, successful profile saves, and
  recommendation opt-out also clear it. A different recommendation starts a
  new conversation, with confirmation when completed turns exist. The selected
  recommendation remains attached to follow-up questions until New conversation
  clears it. For each request, the browser sends only the newest contiguous
  complete exchanges that fit the history limits, while continuing to display
  the full transcript and noting when older exchanges were omitted.
- Every follow-up rebuilds and reauthorizes current nurse and listing context.
  History is client-supplied untrusted data and may be stale; it does not
  replace current permissions or context. The bounded question, history, and
  selected context are sent to the configured provider. If their serialized
  JSON input exceeds 128 KiB, the API reports an explicit provider-input error;
  it does not silently trim otherwise-valid history. A suggested human-support
  escalation is guidance only and does not create a support request.
- Profile and opportunity labels are limited to 200 characters, and serialized
  provider input is capped at 128 KiB.
- Navigator provider configuration, timeout, upstream, and invalid-response
  failures are returned as explicit API errors rather than canned answers.
  Provider calls use synthetic demo data only. Do not send real personal or
  employee information.
- These demo choices are not team-approved final requirements. PostgreSQL schema
  changes currently require manual migration; no deployment or CI is included.

## Backend layout

The FastAPI application is assembled in `backend/app/main.py`. Request models
are in `backend/app/schemas.py`, endpoints are grouped under
`backend/app/routers/`, and reusable matching and Navigator logic lives in
`backend/app/services/`.

## AI provider client

The Navigator endpoint uses an OpenAI-compatible provider. Configure it before
sending Navigator questions; this configuration is not required for unrelated
prototype features. For nurses who have recommendations turned on, the provider receives the
question, bounded conversation history, and freshly selected nurse context.
History is included as labeled untrusted data in the provider's user-message
payload, not as model system/developer instructions. The current context is
rebuilt on every turn, and responses are checked against IDs in its current
listing set. This grounding and validation do not guarantee perfect factuality
or model compliance. When recommendations are off, the server returns a fixed
response without calling the provider or sending that context, unless a
recommendation was selected (which is forbidden while opted out). Use
**synthetic demonstration data only**. Before any real-data use,
revisit provider data processing and retention, authentication, authorization,
consent, privacy, security, and applicable requirements.

The browser transcript is not stored by the API or in browser storage, but
bounded history is transmitted to the configured provider on follow-up requests.
This application does not control provider-side data retention. The serialized
provider input limit is 128 KiB, measured on the UTF-8 bytes of the JSON-encoded
question, context, and history, including JSON escaping; an oversized request
returns an explicit safe error and the UI retains the question for editing or
retry. Start a new conversation if a request cannot fit rather than assuming
that older context will be silently discarded.

Missing or invalid provider configuration returns HTTP 503; provider timeouts
return 504; upstream failures and invalid or out-of-context citations return
502. These errors contain safe messages, not provider details. A successful
response preserves `answer`, `referenced_opportunity_ids`, and
`escalation_suggested`.

Copy `backend/.env.example` to `backend/.env` and set your model and API key
in the copy. The `.env` file is Git-ignored; keep it private and do not share or
commit it. The provider reads this specific file regardless of the working
directory, without changing the process environment. Existing environment
variables take precedence, including variables set to an empty value. `.env`
variable interpolation is not supported. Other application settings, such as
`DATABASE_URL`, still need to be set in the process environment.

The following settings are available in `backend/.env` or the backend process
environment:

| Variable | Purpose | Default |
| --- | --- | --- |
| `GONURSE_AI_BASE_URL` | Chat Completions API base URL, including `/v1` where required | `https://api.openai.com/v1` |
| `GONURSE_AI_MODEL` | Compatible model identifier | Required |
| `GONURSE_AI_API_KEY` | Bearer API key | Required for remote endpoints; optional for localhost |
| `GONURSE_AI_TIMEOUT_SECONDS` | Positive HTTP timeout in seconds | `30` |
| `GONURSE_AI_MAX_OUTPUT_TOKENS` | Positive maximum completion-token count | `1024` |

Do not put credentials in source files or shell history. HTTPS is required except for `localhost` and
literal loopback IP addresses. Redirects and environment-configured HTTP
proxies are disabled. The timeout applies to each HTTP connect, read, write, and
connection-pool operation; it is not a total request deadline.

The server and model must support Chat Completions, JSON-object response mode,
and `max_completion_tokens`. Other compatible servers are not guaranteed to
support these parameters. The client accepts only the expected three-field JSON
answer and limits the response to 256 KiB and answer text to 8,000 characters.
It makes one attempt and raises distinct configuration, input, timeout,
upstream, or response errors rather than returning a canned answer. It does not
log prompts, responses, context, provider error bodies, or credentials.

For an optional manual connectivity check, configure an OpenAI model and API key
privately, then run the following from `Prototype/backend`. This sends synthetic
data to OpenAI and may incur charges; it prints no response content:

```shell
python -c "from app.services.ai_provider import OpenAICompatibleProvider; OpenAICompatibleProvider().generate('Are there any opportunities?', {'current_opportunities': []}); print('Provider smoke test passed')"
```

The offline test suite uses a mock transport and does not require credentials or
network access. No real provider response is required by the automated tests.

## Tests

From `Prototype\backend`, run `python -m pytest -q`. API tests use an isolated,
in-memory SQLite database so they do not touch the user's PostgreSQL database.
To include the PostgreSQL integration test, set `GONURSE_TEST_POSTGRES_URL` to
the connection URL of a dedicated test database before running pytest. The test
creates and removes its own uniquely named schema. From `Prototype\frontend`,
run `npm test` for the frontend unit tests or `npm run test:watch` while
developing. These tests do not require the API or PostgreSQL. The browser build
can be checked with `npm run build`.

GitHub Actions runs the frontend tests and build alongside the backend syntax
check and tests on pushes and pull requests. The PostgreSQL integration test is
skipped in CI unless a test database is configured.
