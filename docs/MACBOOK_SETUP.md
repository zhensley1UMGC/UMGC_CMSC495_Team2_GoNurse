# GoNurse - Complete MacBook Setup Guide (macOS)

**Project:** UMGC CMSC 495 Team 2 — GoNurse  
**Platform:** Apple MacBook (macOS)  
**Purpose:** Local development and testing  
**Status:** Successfully tested on a MacBook

## 1. Introduction

This guide explains how to download, install, configure, and run the GoNurse prototype on a MacBook.

The instructions are based on a successful local installation and are intended to help team members who use macOS rather than Windows.

GoNurse consists of three main technologies:

- **React:** Provides the frontend user interface.
- **Python FastAPI:** Runs the backend API.
- **PostgreSQL:** Stores application data.

**Important:** GoNurse is a local demonstration prototype, not a production application. Use synthetic demonstration data only. Do not enter real patient or employee information.

## 2. Software Used During Testing

The following versions were used during the successful MacBook setup:

| Software | Tested version |
|---|---|
| Python | 3.11.7 |
| Node.js | 24.22 |
| npm | 11.19.1 |
| PostgreSQL | 18.6 |
| Database management | Postgres.app |
| Backend | FastAPI with Uvicorn |
| Frontend | React with Vite |

These are tested versions, not necessarily the project's minimum requirements. Other compatible versions may work.

## 3. Download the GoNurse Repository

1. Open the team's GoNurse GitHub repository.
2. Click the green **Code** button.
3. Select **Download ZIP**.
4. Open Finder on your MacBook.
5. Navigate to the **Downloads** folder.
6. Double-click the downloaded ZIP file to extract it.
7. Open the extracted GoNurse project folder.
8. Locate the `Prototype` folder.

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

## 4. Verify Python Installation

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

## 5. Verify Node.js and npm

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

## 6. Install PostgreSQL Using Postgres.app

PostgreSQL is required for the GoNurse backend database.

### Step 6.1: Download Postgres.app

1. Open https://postgresapp.com/.
2. Download the appropriate Postgres.app version for your Mac.
3. Install the application following the official instructions.
4. Open **Postgres.app**.

### Step 6.2: Start PostgreSQL

1. Select your PostgreSQL server in Postgres.app.
2. Initialize a server if one has not already been configured.
3. Click **Start** if the server is stopped.
4. Confirm that the server displays **Running** with a green status indicator.

During testing, the server displayed:

```text
PostgreSQL 18
Status: Running
Port: 5432
```

Port `5432` is the standard PostgreSQL port used in this guide.

## 7. Create the GoNurse Database

A dedicated database helps keep GoNurse development data separate from other PostgreSQL databases.

### Step 7.1: Open a PostgreSQL Terminal

Use Postgres.app's connection tools or a configured `psql` command to connect to an existing local PostgreSQL database.

For example, if `psql` is available in Terminal and your local PostgreSQL role permits it:

```bash
psql -d postgres
```

### Step 7.2: Create the Database

Inside the PostgreSQL terminal, execute:

```sql
CREATE DATABASE gonurse_prototype;
```

If `gonurse_prototype` already exists, skip this command.

### Step 7.3: Connect to the Database

Run:

```text
\c gonurse_prototype
```

Then verify the active database:

```sql
SELECT current_database();
```

Expected result:

```text
gonurse_prototype
```

### Step 7.4: Verify in Postgres.app

During the successful MacBook setup, Postgres.app displayed these databases:

| Database | Purpose |
|---|---|
| `gonurse_prototype` | Dedicated GoNurse database |
| `postgres` | Existing default PostgreSQL database |
| `protech` | Existing local user database |
| `template1` | PostgreSQL template database |

The GoNurse database was created without deleting or modifying the existing databases.

**Important:** Do not delete existing databases to install GoNurse.

When finished with the PostgreSQL command-line session, enter:

```text
\q
```

## 8. Open the Backend Folder in Terminal

The backend contains the Python FastAPI application.

### Step 8.1: Locate the Backend

1. Open Finder.
2. Navigate to the extracted GoNurse project.
3. Open the `Prototype` folder.
4. Locate the `backend` folder.

### Step 8.2: Navigate Using Terminal

1. Open Terminal.
2. Type `cd` followed by one space.
3. Drag the `backend` folder from Finder into the Terminal window.
4. Press Return.

This method automatically inserts the correct folder path and avoids manually typing a long directory name.

Your Terminal should now be inside:

```text
Prototype/backend
```

## 9. Create a Python Virtual Environment

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

## 11. Configure the PostgreSQL Database Connection

The backend needs a database connection string to communicate with PostgreSQL.

In the same backend Terminal window, run:

```bash
export DATABASE_URL='postgresql+psycopg://YOUR_DB_USER@localhost:5432/gonurse_prototype'
```

Replace `YOUR_DB_USER` with the PostgreSQL role configured on your MacBook.

For example, during the successful local test, the PostgreSQL role matched the macOS account username and the local connection did not require a password.

Other computers may require different PostgreSQL authentication settings.

The connection string specifies:

- `postgresql+psycopg`: PostgreSQL connection using the psycopg driver.
- `localhost`: The database is running on the same computer.
- `5432`: The PostgreSQL port.
- `gonurse_prototype`: The dedicated GoNurse database.

**Security:** Never commit real passwords or other secrets to GitHub.

The `export` command sets the environment variable for the current Terminal session. You will normally need to run it again when opening a new backend Terminal session.

## 12. Start the FastAPI Backend

Make sure:

- PostgreSQL is running.
- The backend virtual environment is active.
- The `DATABASE_URL` environment variable is configured.

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

## 13. Open a Second Terminal for the Frontend

The React frontend runs separately from the Python backend.

1. Open a second Terminal window.
2. Open Finder.
3. Locate the `Prototype/frontend` folder.
4. Type `cd` followed by one space in the second Terminal.
5. Drag the `frontend` folder from Finder into Terminal.
6. Press Return.

The second Terminal should now be inside:

```text
Prototype/frontend
```

Do not close the backend Terminal window.

## 14. Install Frontend Dependencies

In the frontend Terminal window, run:

```bash
npm install
```

This installs the JavaScript dependencies specified by the frontend project.

During testing, installation completed successfully.

npm may display informational notices or warnings. Review them rather than assuming that every warning means installation failed.

## 15. Start the React Frontend

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
| PostgreSQL | Postgres.app, port 5432 |
| FastAPI backend | `http://127.0.0.1:8000` |
| React frontend | `http://127.0.0.1:5173` |

Keep PostgreSQL running and both Terminal windows open while testing the application.

## 16. How to Stop GoNurse

When you finish working:

1. Go to the frontend Terminal window.
2. Press **Control + C** to stop the frontend development server.
3. Go to the backend Terminal window.
4. Press **Control + C** to stop FastAPI.
5. Stop PostgreSQL in Postgres.app if no other local application needs it.

Stopping these services does not delete the GoNurse database or project files.

## 17. How to Restart GoNurse Later

You do not need to repeat the complete installation every time you want to use GoNurse.

### Step 17.1: Start PostgreSQL

Open Postgres.app and confirm that PostgreSQL is running.

### Step 17.2: Restart the Backend

Open Terminal in the existing `Prototype/backend` folder.

Activate the virtual environment:

```bash
source .venv/bin/activate
```

Configure the database connection:

```bash
export DATABASE_URL='postgresql+psycopg://YOUR_DB_USER@localhost:5432/gonurse_prototype'
```

Start FastAPI:

```bash
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### Step 17.3: Restart the Frontend

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

## 18. Troubleshooting

### Problem: PostgreSQL Is Not Running

**Possible cause:** The database server is stopped.

**Solution:**

1. Open Postgres.app.
2. Select the PostgreSQL server.
3. Click **Start** if necessary.
4. Confirm that the status shows **Running**.

### Problem: Backend Cannot Connect to PostgreSQL

**Possible causes:**

- PostgreSQL is stopped.
- The database name is incorrect.
- The PostgreSQL username is incorrect.
- The local database requires authentication.

**Solution:** Confirm the database exists, PostgreSQL is running, and `DATABASE_URL` matches your local configuration.

### Problem: Python Module Not Found

**Possible cause:** The Python virtual environment is not active or dependencies were not installed.

**Solution:**

In the backend folder, run:

```bash
source .venv/bin/activate
python -m pip install -r requirements.txt
```

### Problem: Backend Shows 404

**Possible cause:** You opened the root backend URL instead of an API endpoint.

**Solution:** Visit:

http://127.0.0.1:8000/docs

### Problem: Frontend Does Not Start

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

### Problem: Port Is Already in Use

**Possible cause:** Another development server is already running.

**Solution:** Check whether a previous backend or frontend Terminal session is still active. Stop the old development server if appropriate before restarting.

Do not terminate unrelated processes without identifying them first.

## 19. Security and Development Limitations

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

## 20. Local Setup Verification

The following setup tasks were completed successfully during MacBook testing:

| Verification task | Result |
|---|---|
| Python installation checked | Successful |
| Node.js and npm checked | Successful |
| PostgreSQL 18 started | Successful |
| Dedicated GoNurse database created | Successful |
| PostgreSQL database connection verified | Successful |
| Python virtual environment created | Successful |
| Backend dependencies installed | Successful |
| FastAPI backend launched | Successful |
| Frontend dependencies installed | Successful |
| React/Vite development server launched | Successful |
| GoNurse interface opened in browser | Successful |

**Testing scope:** These results confirm that the local development environment was successfully configured and that the prototype started. Automated test suites, CI/CD checks, and full functional verification are separate activities.

## 21. Future Improvements

Possible future improvements include:

- Adding screenshots for each major installation step.
- Adding macOS-specific troubleshooting examples.
- Linking this guide from the main project README.
- Adding automated backend and frontend checks through GitHub Actions.
- Verifying the setup instructions on additional MacBook configurations.

## Conclusion

The GoNurse prototype was successfully configured and launched on a MacBook using PostgreSQL, Python FastAPI, and React.

This guide documents the installation process to improve onboarding, reduce environment setup difficulties, and support collaboration among team members using different operating systems.

**End of MacBook Setup Guide**
