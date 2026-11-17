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
  Unsupported or insufficiently supported questions can be escalated; a support
  action opens the existing form without copying the conversation. The nurse
  must explicitly complete and submit the request.
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

- Docker Desktop or Docker Engine with the Compose plugin, Python 3.12 with pip,
  and Node.js with npm. CI and the pinned backend dependencies use Python 3.12.
  The frontend test runner requires Node.js 22.12 or later on the 22.x line,
  Node.js 24.x, or Node.js 26 or later. Frontend lint requires Node.js 22.13 or
  later on the 22.x line, Node.js 24.x, or Node.js 26 or later.
- Docker provides the local PostgreSQL databases; a separate host PostgreSQL
  installation is not required.

## Download the prototype

On the team's GitHub repository page, select **Code > Download ZIP** and extract
the archive, or clone the repository using the URL provided by GitHub. If the
repository is private, you will need access to it. Locate the `Prototype` folder
in the downloaded files; the commands below start from that folder.

## Start the local PostgreSQL service

From the repository root, copy `docker/postgres/.env.example` to
`docker/postgres/.env`. Replace each example password with a private local
value, using a distinct URL-safe alphanumeric password for each role. The
database `.env` file is Git-ignored; do not commit or share it. The example
values are placeholders and must be replaced before startup.

```shell
cp docker/postgres/.env.example docker/postgres/.env
```

On Windows PowerShell, use:

```powershell
Copy-Item docker/postgres/.env.example docker/postgres/.env
```

If you already have `docker/postgres/.env` from an earlier setup, keep its
existing passwords and add a distinct `GONURSE_APP_TEST_PASSWORD` value from
the updated example file; do not overwrite your local credentials.

Start Docker Desktop (or the Docker Engine), edit `docker/postgres/.env`, then
run this from the repository root:

```shell
docker compose --env-file docker/postgres/.env up -d --wait
docker compose --env-file docker/postgres/.env ps
```

The PostgreSQL/pgvector service listens on `127.0.0.1:5432` by default. To use
another host port, set `GONURSE_PG_PORT` in `docker/postgres/.env` and use that
port in the
connection URLs below. The Compose health check waits for PostgreSQL to accept
connections. If it does not become healthy, inspect
`docker compose --env-file docker/postgres/.env ps` and
`docker compose --env-file docker/postgres/.env logs postgres`; these commands
do not print the configured passwords.

The service initializes four separate databases and four non-superuser roles:

| Purpose | Database | Role | SQLAlchemy setting and URL shape |
| --- | --- | --- | --- |
| Application | `gonurse_app` | `gonurse_app` | `DATABASE_URL`: `postgresql+psycopg://gonurse_app:YOUR_APP_PASSWORD@127.0.0.1:5432/gonurse_app` |
| Application integration test | `gonurse_app_test` | `gonurse_app_test` | `GONURSE_TEST_POSTGRES_URL`: `postgresql+psycopg://gonurse_app_test:YOUR_APP_TEST_PASSWORD@127.0.0.1:5432/gonurse_app_test` |
| Synthetic benchmark | `gonurse_benchmark` | `gonurse_benchmark` | `GONURSE_BENCHMARK_DATABASE_URL`: `postgresql+psycopg://gonurse_benchmark:YOUR_BENCHMARK_PASSWORD@127.0.0.1:5432/gonurse_benchmark` |
| Optional benchmark integration test | `gonurse_benchmark_test` | `gonurse_benchmark_test` | `GONURSE_BENCHMARK_TEST_DATABASE_URL`: `postgresql+psycopg://gonurse_benchmark_test:YOUR_BENCHMARK_TEST_PASSWORD@127.0.0.1:5432/gonurse_benchmark_test` |

Use the password for the matching role from your local
`docker/postgres/.env` file when constructing each `postgresql+psycopg://` URL.
The benchmark and benchmark-test databases have the `vector` extension; the
application and application-test databases do not. Each test role can connect
only to its own test database and create an isolated schema there. The app
creates its normal tables in `gonurse_app`; benchmark setup must use only
`gonurse_benchmark` and continue to require its explicit schema-creation opt-in.

For example, from `Prototype/backend`, set the application URL in the terminal
where you will run FastAPI (substitute the local app password and configured
port; do not save the completed URL in source control):

```powershell
$env:DATABASE_URL = Read-Host 'Application database URL'
```

```shell
printf 'Application database URL: '
IFS= read -r -s DATABASE_URL
export DATABASE_URL
printf '\n'
```

For the benchmark, set `GONURSE_BENCHMARK_DATABASE_URL` to the benchmark role
and database, not `DATABASE_URL`. Set
`GONURSE_BENCHMARK_TEST_DATABASE_URL` separately for the optional benchmark
integration test. Neither setting should fall back to `DATABASE_URL` or point
to another purpose's database. The application persistence test uses
`GONURSE_TEST_POSTGRES_URL` with the `gonurse_app_test` role and database; it
does not fall back to `DATABASE_URL` or use either benchmark database.

The data is kept in the named Docker volume. Stop the service without deleting
data using:

```shell
docker compose --env-file docker/postgres/.env down
```

Starting it again with
`docker compose --env-file docker/postgres/.env up -d --wait` preserves that
volume. The initializer runs automatically only when the data directory is empty. It
is safe to run again after an update to provision newly added databases and
roles without deleting existing data. For an existing volume, first add
`GONURSE_APP_TEST_PASSWORD` from `.env.example` to the local `.env`, then run:

```shell
docker compose --env-file docker/postgres/.env up -d --wait
docker compose --env-file docker/postgres/.env exec --user postgres -T postgres bash /docker-entrypoint-initdb.d/10-init-databases.sh
```

Re-running the script creates missing roles and databases and leaves existing
role passwords unchanged. Editing `docker/postgres/.env` alone does not change
existing passwords. Removing the volume with
`docker compose --env-file docker/postgres/.env down -v` permanently deletes the
local database data; do not use that command as routine shutdown.

This is local-development tooling only. Keep the port loopback-bound and use
synthetic data only; never use production, patient, or real employee data.

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

## Configure PostgreSQL for Windows

Use the shared Docker Compose setup in **Start the local PostgreSQL service**
above; a host PostgreSQL installation and pgAdmin are not required. Run Compose
from the repository root, then set `DATABASE_URL` in the backend terminal to
the `gonurse_app` database using the `gonurse_app` role and the local app
password. The application creates its tables and two synthetic opportunities
there at startup.

## Run on Windows

Open PowerShell and change to the `Prototype` folder inside your extracted or
cloned repository. For example, enter `cd ` followed by the folder's full
path in quotes. Then run:

```powershell
cd .\backend
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
# Enter the URL for gonurse_app, using the local app password and Compose port.
$env:DATABASE_URL = Read-Host 'Application database URL'
.\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

`Read-Host` displays the URL as you enter it, including your password, but does
not add the input to PowerShell command history. Keep this backend terminal
open while using the app.

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
  changes currently require manual migration; no deployment is included.

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
the `gonurse_app_test` URL from the database table above before running pytest.
The test creates and removes its own uniquely named schema; it never uses the
application or benchmark database. From `Prototype\frontend`,
run `npm test` for the frontend unit tests or `npm run test:watch` while
developing. These tests do not require the API or PostgreSQL. The browser build
can be checked with `npm run build`.

## CI and release candidates

GitHub Actions runs on pull requests and pushes to `main`. Feature-branch pushes
do not independently trigger this workflow, so an open pull request does not
cause duplicate push and pull-request runs. The `frontend` job installs from
`package-lock.json`, lints, tests, and builds; the `backend` job installs from
the pinned `requirements.txt`, lints, checks syntax, and tests. Both jobs have
timeouts. The optional PostgreSQL integration test is skipped in CI; the other
backend tests use SQLite.

Run the same checks locally from `frontend` with `npm ci`, `npm run lint`,
`npm test`, and `npm run build`; from `backend`, run
`python -m pip install -r requirements.txt`,
`python -m ruff check --select E9,F63,F7,F82 app tests`,
`python -m compileall -q app`, and `python -m pytest -q`.

The backend's direct dependency ranges are in `backend/requirements.in`;
`backend/requirements.txt` pins transitive dependencies for CI and local use.
To regenerate it using Python 3.12 and uv 0.9.26, install `uv==0.9.26` in a
separate environment and run the following from `backend`:

```shell
uv pip compile --python 3.12 --python-version 3.12 --universal --no-header requirements.in -o requirements.txt
```

Use `--upgrade` deliberately when updating locked versions, and review and
test the resulting lockfile on supported platforms.

After both jobs succeed on a push to `main`, the delivery job rebuilds the
frontend and uploads a versioned `gonurse-rc-<run-number>-<attempt>-<commit-sha>`
artifact. Open the successful workflow run under the repository's **Actions**
tab and download it from **Artifacts**. Access and retention depend on the
repository's GitHub settings. Pull requests and failed checks do not publish
release candidates. The artifact includes the full commit SHA, built frontend,
backend source, pinned dependency information, and its own local setup guide
([source](RELEASE_CANDIDATE.md)). It contains no environment files or
credentials. This is a downloadable release candidate, **not a deployment**:
it remains a local-only, synthetic-data-only prototype.

To enforce the checks before merging, a repository administrator can create or
edit a branch protection rule or ruleset for `main` and require both the
`frontend` and `backend` checks shown in the pull request's checks list. The
exact displayed check names should be selected from a completed run. Rules
availability and editing depend on repository permissions and GitHub plan;
documentation alone does not enforce them.
