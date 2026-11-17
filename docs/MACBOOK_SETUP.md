# GoNurse - Complete MacBook Setup Guide (macOS)

**Project:** UMGC CMSC 495 Team 2 — GoNurse  
**Platform:** Apple MacBook (macOS)  
**Purpose:** Local development and testing  
**Status:** Updated for Docker Compose; verify against your local Mac setup

1. Introduction

This guide explains how to download, install, configure, and run the GoNurse prototype on a MacBook.

The instructions are based on a successful local installation and are intended to help team members who use macOS rather than Windows.

GoNurse consists of three main technologies:

- **React:** Provides the frontend user interface.
- **Python FastAPI:** Runs the backend API.
- **Docker Compose:** Runs the local PostgreSQL/pgvector database service.

**Important:** GoNurse is a local demonstration prototype, not a production application. Use synthetic demonstration data only. Do not enter real patient or employee information.

2. Software Used During Testing

The following versions were used during the successful MacBook setup:

| Software | Tested version |
|---|---|
| Python | 3.11.7 |
| Node.js | 24.22 |
| npm | 11.19.1 |
| Pinned PostgreSQL container | 16 (`pgvector/pgvector:0.8.1-pg16`) |
| Container management | Docker Desktop and Docker Compose |
| Backend | FastAPI with Uvicorn |
| Frontend | React with Vite |

These are tested versions, not necessarily the project's minimum requirements. Other compatible versions may work.

3. Download the GoNurse Repository

a. Open the team's GoNurse GitHub repository.
b. Click the green **Code** button.
c. Select **Download ZIP**.
d. Open Finder on your MacBook.
e. Navigate to the **Downloads** folder.
f. Double-click the downloaded ZIP file to extract it.
g. Open the extracted GoNurse project folder.
h. Locate the `Prototype` folder.

The project contains the following main directories:

```text
UMGC_CMSC495_Team2_GoNurse/
├── Prototype/
│   ├── backend/
│   └── frontend/
├── docs/
└── README.md
```

The `backend` and `frontend` folders will be used during installation.

**Note:** Downloading a ZIP file is sufficient to run the prototype locally. However, a ZIP download does not contain Git history. To contribute code through Git commands, clone the repository instead.

4. Verify Python Installation

Python is required to run the FastAPI backend.

### Step 4.1: Open Terminal

1. Press **Command + Space** on your MacBook.
2. Type `Terminal`.
3. Press Return to open it.

### Step 4.2: Check Python

Enter:

```bash
python3 --version
```

During testing, the result was:

```text
Python 3.11.7
```

If Python is not installed, download a compatible Python 3.11 release from:

https://www.python.org/downloads/

After installation, reopen Terminal and verify the version.

5. Verify Node.js and npm

Node.js and npm are required to run the React frontend.

In Terminal, enter:

```bash
node --version
```

Then:

```bash
npm --version
```

During testing, the installed versions were Node.js 24.22 and npm 11.19.1.

If Node.js or npm is missing, visit:

https://nodejs.org/

Install a compatible version and verify both commands again.

## 6. Install and Start Docker Desktop

Install Docker Desktop for Mac by following the instructions at
https://www.docker.com/products/docker-desktop/, then open it and wait until
the Docker Engine is running. Docker Compose starts the project's pinned
PostgreSQL/pgvector container; Postgres.app and a separate host PostgreSQL
installation are not required.

From the repository root, copy the credential template and edit the copy:

```bash
cp docker/postgres/.env.example docker/postgres/.env
```

If you already have `docker/postgres/.env` from an earlier setup, keep its
existing passwords and add a distinct `GONURSE_APP_TEST_PASSWORD` value from
the updated example file; do not overwrite your local credentials.

Set distinct private local passwords in `docker/postgres/.env` for the
PostgreSQL administrator, application, application-test, benchmark, and
benchmark-test roles. Use URL-safe alphanumeric values.
`docker/postgres/.env` is ignored by Git; never commit or share it. The example
values are placeholders.

Start the service and wait until its health check succeeds:

```bash
docker compose --env-file docker/postgres/.env up -d --wait
docker compose --env-file docker/postgres/.env ps
```

The database is bound only to `127.0.0.1:5432`. To use another port, set
`GONURSE_PG_PORT` in `docker/postgres/.env` and use that port in the connection URL.

Compose creates isolated application, application-test, benchmark, and
benchmark-test databases, each with a separate login role. The `vector`
extension is enabled only in the benchmark and benchmark-test databases. Each
test role can connect only to its own database and create its own schema there.

The initializer runs automatically only on a fresh data volume. For an
existing volume, add `GONURSE_APP_TEST_PASSWORD` to the local `.env`, start the
service, then rerun the idempotent initializer to add the test databases:

```bash
docker compose --env-file docker/postgres/.env up -d --wait
docker compose --env-file docker/postgres/.env exec --user postgres -T postgres bash /docker-entrypoint-initdb.d/10-init-databases.sh
```

The script creates missing roles and databases and leaves existing role
passwords unchanged. Editing the `.env` alone does not change existing
passwords.

## 7. Database Layout and Connection URLs

Use the password for the matching role from `docker/postgres/.env` and the
configured Compose port (default `5432`) in each URL:

| Purpose | Database and role | Environment setting |
|---|---|---|
| Application | `gonurse_app` / `gonurse_app` | `DATABASE_URL=postgresql+psycopg://gonurse_app:YOUR_APP_PASSWORD@127.0.0.1:5432/gonurse_app` |
| Application integration test | `gonurse_app_test` / `gonurse_app_test` | `GONURSE_TEST_POSTGRES_URL=postgresql+psycopg://gonurse_app_test:YOUR_APP_TEST_PASSWORD@127.0.0.1:5432/gonurse_app_test` |
| Benchmark | `gonurse_benchmark` / `gonurse_benchmark` | `GONURSE_BENCHMARK_DATABASE_URL=postgresql+psycopg://gonurse_benchmark:YOUR_BENCHMARK_PASSWORD@127.0.0.1:5432/gonurse_benchmark` |
| Benchmark integration test | `gonurse_benchmark_test` / `gonurse_benchmark_test` | `GONURSE_BENCHMARK_TEST_DATABASE_URL=postgresql+psycopg://gonurse_benchmark_test:YOUR_BENCHMARK_TEST_PASSWORD@127.0.0.1:5432/gonurse_benchmark_test` |

Keep the benchmark and its test on their explicit settings, never
`DATABASE_URL`. Benchmark schema creation must remain opt-in. Both integration
tests use their own test database and role; the application test setting never
falls back to `DATABASE_URL`.

## 8. Open the Backend Folder in Terminal

The backend contains the Python FastAPI application.

### Step 8.1: Locate the Backend

a. Open Finder.
b. Navigate to the extracted GoNurse project.
c. Open the `Prototype` folder.
d. Locate the `backend` folder.

 Step 8.2: Navigate Using Terminal

a. Open Terminal.
b. Type `cd` followed by one space.
c Drag the `backend` folder from Finder into the Terminal window.
d. Press Return.

This method automatically inserts the correct folder path and avoids manually typing a long directory name.

Your Terminal should now be inside:

```text
Prototype/backend
```

 9. Create a Python Virtual Environment

A virtual environment keeps GoNurse's Python dependencies separate from other Python projects.

While inside the backend folder, run:

```bash
python3 -m venv .venv
```

This creates a `.venv` folder containing the isolated Python environment.

Activate it:

```bash
source .venv/bin/activate
```

After activation, the Terminal prompt should display `(.venv)`.

You only need to create the virtual environment once, unless it is deleted or needs to be rebuilt.

## 10. Install Backend Dependencies

With the virtual environment activated, run:

```bash
python -m pip install -r requirements.txt
```

This installs the Python packages specified by the GoNurse backend.

Wait until installation completes successfully before continuing.

If an installation error occurs, read the error message before retrying. Do not delete unrelated Python installations or system files.

11. Configure the Application Database Connection

The backend uses the dedicated `gonurse_app` database and `gonurse_app` role.
In the backend Terminal, enter the complete local URL without saving it in
shell history:

```bash
read -s -p 'Application database URL: ' DATABASE_URL; export DATABASE_URL; echo
```

Use this format, replacing the password and port with your local values:
`postgresql+psycopg://gonurse_app:YOUR_APP_PASSWORD@127.0.0.1:5432/gonurse_app`.
The URL is active only in the current terminal session; repeat this step in a
new backend terminal.

The benchmark must use `GONURSE_BENCHMARK_DATABASE_URL` with the
`gonurse_benchmark` database and benchmark role. Its optional PostgreSQL test
must use the separate `GONURSE_BENCHMARK_TEST_DATABASE_URL` setting, test
database, and test role. Neither setting falls back to `DATABASE_URL` or points
to another purpose's database. The app's optional persistence test uses
`GONURSE_TEST_POSTGRES_URL` with the `gonurse_app_test` database and role.

12. Start the FastAPI Backend

Make sure:

- Docker Compose reports PostgreSQL as healthy.
- The backend virtual environment is active.
- The `DATABASE_URL` environment variable is configured.

Career Navigator questions also require AI provider configuration. This is
optional for other prototype features; see the
[Prototype README provider setup](../Prototype/README.md#ai-provider-client)
for the supported settings. Without provider configuration, Navigator requests
return an explicit error.

Then run:

```bash
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The backend should start on:

http://127.0.0.1:8000

### Verify the Backend

Open your web browser and visit:

http://127.0.0.1:8000/docs

This displays the FastAPI interactive API documentation.

**Important:** Visiting `http://127.0.0.1:8000/` may display a `404 Not Found` response because the application does not define a root endpoint.

This does not necessarily indicate that the backend failed.

Keep the backend Terminal window open while using GoNurse.

### FastAPI Backend Screenshot

The screenshot below shows the GoNurse backend running
successfully and displaying its API documentation.

![GoNurse FastAPI backend](images/backend-running.png)

 13. Open a Second Terminal for the Frontend

The React frontend runs separately from the Python backend.

a. Open a second Terminal window.
b. Open Finder.
c. Locate the `Prototype/frontend` folder.e
d. Type `cd` followed by one space in the second Terminal.
e. Drag the `frontend` folder from Finder into Terminal.
f. Press Return.

The second Terminal should now be inside:

```text
Prototype/frontend
```

Do not close the backend Terminal window.

 14. Install Frontend Dependencies

In the frontend Terminal window, run:

```bash
npm install
```

This installs the JavaScript dependencies specified by the frontend project.

During testing, installation completed successfully.

npm may display informational notices or warnings. Review them rather than assuming that every warning means installation failed.

 15. Start the React Frontend

In the frontend Terminal, run:

```bash
npm run dev
```

This starts the Vite development server.

During testing, the frontend was available at:

http://127.0.0.1:5173/

Open this URL in your browser.

The GoNurse user interface should appear.

### Important: Keep Both Servers Running

GoNurse requires the following local services:

| Component | Location |
|---|---|
| PostgreSQL | Docker Compose, loopback port 5432 by default |
| FastAPI backend | `http://127.0.0.1:8000` |
| React frontend | `http://127.0.0.1:5173` |

Keep PostgreSQL running and both Terminal windows open while testing the application.

### GoNurse Frontend Screenshot

The screenshot below shows the GoNurse application
running successfully on a MacBook.

![GoNurse React frontend running locally](images/frontend-running.png)

 16. How to Stop GoNurse

When you finish working:
a. Go to the frontend Terminal window.
b. Press **Control + C** to stop the frontend development server.
c. Go to the backend Terminal window.
d. Press **Control + C** to stop FastAPI.
e. From the repository root, run
   `docker compose --env-file docker/postgres/.env down` to stop PostgreSQL.

`docker compose --env-file docker/postgres/.env down` preserves the named data
volume. Do not use `docker compose --env-file docker/postgres/.env down -v`
unless you intend to permanently delete the local database data. Initialization
runs automatically only on a fresh data volume; rerun the initializer as
described in Section 6 to provision new databases on an existing volume.

17. How to Restart GoNurse Later

You do not need to repeat the complete installation every time you want to use GoNurse.

Step 17.1: Start PostgreSQL

From the repository root, start the container and wait for health:

```bash
docker compose --env-file docker/postgres/.env up -d --wait
```

Step 17.2: Restart the Backend

Open Terminal in the existing `Prototype/backend` folder.

Activate the virtual environment:

```bash
source .venv/bin/activate
```

Configure the app database connection (enter the URL for `gonurse_app`):

```bash
read -s -p 'Application database URL: ' DATABASE_URL; export DATABASE_URL; echo
```

Start FastAPI:

```bash
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Step 17.3: Restart the Frontend

Open a second Terminal in `Prototype/frontend`.

Run:

```bash
npm run dev
```

### Step 17.4: Open GoNurse

Visit:

http://127.0.0.1:5173/

The application should be available again.

You normally do not need to recreate the database, reinstall dependencies, or recreate `.venv` unless something has changed.

18. Troubleshooting

Problem: PostgreSQL Container Is Not Healthy

**Possible causes:** Docker Desktop is stopped, the configured port is in use,
or the container failed during first-time initialization.

**Solution:**

1. Open Docker Desktop and confirm that its engine is running.
2. From the repository root, inspect
   `docker compose --env-file docker/postgres/.env ps` and
   `docker compose --env-file docker/postgres/.env logs postgres`.
3. If port `5432` is occupied, set a free `GONURSE_PG_PORT` in
   `docker/postgres/.env` and use
   that port in `DATABASE_URL`.

Problem: Backend Cannot Connect to PostgreSQL

**Possible causes:**

- The container is unhealthy.
- The URL does not use `gonurse_app`.
- The app password or port does not match local Compose configuration.

**Solution:** Check Compose health and confirm that `DATABASE_URL` uses the
`gonurse_app` role, local app password, `gonurse_app` database, and configured
Compose port.

 roblem: Python Module Not Found

**Possible cause:** The Python virtual environment is not active or dependencies were not installed.

**Solution:**

In the backend folder, run:

```bash
source .venv/bin/activate
python -m pip install -r requirements.txt
```

Problem: Backend Shows 404

**Possible cause:** You opened the root backend URL instead of an API endpoint.

**Solution:** Visit:

http://127.0.0.1:8000/docs

Problem: Frontend Does Not Start

**Possible causes:**

- Node.js or npm is unavailable.
- Frontend dependencies are missing.
- Terminal is in the wrong directory.

**Solution:**

Confirm that Terminal is inside `Prototype/frontend`, then run:

```bash
npm install
npm run dev
```

Problem: Port Is Already in Use

Possible cause:** Another development server is already running.

Solution:** Check whether a previous backend or frontend Terminal session is still active. Stop the old development server if appropriate before restarting.

Do not terminate unrelated processes without identifying them first.

19. Security and Development Limitations

GoNurse is currently a local prototype.

For safe development:

- Use only synthetic demonstration data.
- Keep development servers bound to localhost.
- Do not expose the prototype to the public internet.
- Do not enter real patient or employee information.
- Do not publish database passwords, API keys, or private credentials.
- Do not assume that demonstration user selection provides secure authentication.
- Review and test changes before integrating them into the team's main branch.

Successful local startup does not mean the application has passed production security, performance, or functional testing.

20. Local Setup Verification

The following setup tasks were completed successfully during MacBook testing:

| Verification task | Result |
|---|---|
| Python installation checked | Successful |
| Node.js and npm checked | Successful |
| Docker Compose PostgreSQL service started | Successful |
| Separate app and benchmark databases provisioned | Successful |
| PostgreSQL database connection verified | Successful |
| Python virtual environment created | Successful |
| Backend dependencies installed | Successful |
| FastAPI backend launched | Successful |
| Frontend dependencies installed | Successful |
| React/Vite development server launched | Successful |
| GoNurse interface opened in browser | Successful |

**Testing scope:** These results confirm that the local development environment was successfully configured and that the prototype started. Automated test suites, CI/CD checks, and full functional verification are separate activities.

21. Future Improvements

Possible future improvements include:

- Adding screenshots for each major installation step.
- Adding macOS-specific troubleshooting examples.
- Linking this guide from the main project README.
- Adding automated backend and frontend checks through GitHub Actions.
- Verifying the setup instructions on additional MacBook configurations.

Conclusion

The GoNurse prototype was successfully configured and launched on a MacBook using PostgreSQL, Python FastAPI, and React.

This guide documents the installation process to improve onboarding, reduce environment setup difficulties, and support collaboration among team members using different operating systems.

**End of MacBook Setup Guide**
