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
- A rule-based Career Navigator that lists opportunities, answers basic profile
  questions, and displays an existing recommendation's explanation. It suggests
  support when it cannot answer, without submitting a request automatically.
- Nurse-created support requests and administrator responses visible to the
  requesting nurse.

**AI limitation:** Career Navigator and matching are deterministic demonstrations,
not AI models. Embeddings, semantic search, LangGraph, and an AI chatbot are not
implemented. This does not satisfy Unit 5's functional AI requirement by itself.

**Security limitation:** Demo identities are client-selected headers, not real
authentication. The service uses local HTTP, not production HTTPS. Authorization
checks demonstrate role and ownership logic only; no real users should rely on
them. No hospital or external customer database is connected. The sample data is
fabricated, and the system has not been validated for 10,000 users.

## Prerequisites

- Python with pip, Node.js with npm, and a running PostgreSQL server.
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
- A chatbot request may include a `recommendation_id` to identify the existing
  recommendation. Opt-out blocks generating or explaining recommendations.
- These demo choices are not team-approved final requirements. PostgreSQL schema
  changes currently require manual migration; no deployment or CI is included.

## Tests

From `Prototype\backend`, run `python -m pytest -q`. API tests use an isolated,
in-memory SQLite database so they do not touch the user's PostgreSQL database.
To include the PostgreSQL integration test, set `GONURSE_TEST_POSTGRES_URL` to
the connection URL of a dedicated test database before running pytest. The test
creates and removes its own uniquely named schema. The browser build can be
checked from `Prototype\frontend` with `npm run build`.
