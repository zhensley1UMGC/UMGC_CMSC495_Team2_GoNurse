# GoNurse release candidate: local setup

This artifact is a **release candidate**, not a deployment or production
software. Use synthetic data only. Do not use patient records, real employee
information, or other sensitive data, and do not expose the app to a network.
Demo identities are not real authentication. The source commit and workflow
run are recorded in `RELEASE_INFO.txt`.

The archive contains a prebuilt frontend, backend source, and dependency
lockfiles. Install Python 3.12, Node.js 24 and npm, and PostgreSQL. Create an
empty, dedicated local PostgreSQL database; the backend creates its own
tables and synthetic sample listings. Never use an existing hospital or
customer database. The connection URL uses the `postgresql+psycopg://` scheme.
Keep credentials private and percent-encode special characters in the URL.

Run the following from the extracted artifact. Keep both terminals open.

## Windows PowerShell

In the first terminal:

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
$env:DATABASE_URL = Read-Host 'Local PostgreSQL URL (postgresql+psycopg://...)'
.\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

`Read-Host` displays the URL, including its password. Protect the terminal.
In a second terminal, starting from the extracted artifact:

```powershell
cd frontend
npm ci
npm exec -- vite preview --host 127.0.0.1 --port 5173 --strictPort
```

## macOS or Linux

In the first terminal:

```sh
cd backend
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
printf 'Local PostgreSQL URL (postgresql+psycopg://...): '
IFS= read -r DATABASE_URL
export DATABASE_URL
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The URL, including its password, is visible while typed. Protect the terminal.
In a second terminal, starting from the extracted artifact:

```sh
cd frontend
npm ci
npm exec -- vite preview --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://127.0.0.1:5173/` or
`http://127.0.0.1:5173/tabbed.html`. Preview serves the packaged build and
forwards `/api` requests to the local backend. No frontend rebuild is needed.
Stop each server with Ctrl+C.

Career Navigator's AI provider is optional for other prototype features.
To use it, set `GONURSE_AI_MODEL` and, for a remote provider,
`GONURSE_AI_API_KEY` privately in the backend process environment before
starting the backend. `GONURSE_AI_BASE_URL` can select an OpenAI-compatible
provider. Provider calls transmit synthetic demo context and may incur
charges; provider-side retention is outside the app's control. No environment
file or credentials are included in this artifact.
