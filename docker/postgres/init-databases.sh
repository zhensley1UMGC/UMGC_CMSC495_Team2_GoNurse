#!/usr/bin/env bash
set -eu

: "${GONURSE_APP_PASSWORD:?GONURSE_APP_PASSWORD is required}"
: "${GONURSE_APP_TEST_PASSWORD:?GONURSE_APP_TEST_PASSWORD is required}"
: "${GONURSE_BENCHMARK_PASSWORD:?GONURSE_BENCHMARK_PASSWORD is required}"
: "${GONURSE_BENCHMARK_TEST_PASSWORD:?GONURSE_BENCHMARK_TEST_PASSWORD is required}"

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 \
  --set=app_password="$GONURSE_APP_PASSWORD" \
  --set=app_test_password="$GONURSE_APP_TEST_PASSWORD" \
  --set=benchmark_password="$GONURSE_BENCHMARK_PASSWORD" \
  --set=benchmark_test_password="$GONURSE_BENCHMARK_TEST_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE gonurse_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gonurse_app')
\gexec
SELECT format('CREATE ROLE gonurse_app_test LOGIN PASSWORD %L', :'app_test_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gonurse_app_test')
\gexec
SELECT format('CREATE ROLE gonurse_benchmark LOGIN PASSWORD %L', :'benchmark_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gonurse_benchmark')
\gexec
SELECT format('CREATE ROLE gonurse_benchmark_test LOGIN PASSWORD %L', :'benchmark_test_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gonurse_benchmark_test')
\gexec

SELECT 'CREATE DATABASE gonurse_app OWNER gonurse_app'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'gonurse_app')
\gexec
SELECT 'CREATE DATABASE gonurse_app_test OWNER postgres'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'gonurse_app_test')
\gexec
SELECT 'CREATE DATABASE gonurse_benchmark OWNER gonurse_benchmark'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'gonurse_benchmark')
\gexec
SELECT 'CREATE DATABASE gonurse_benchmark_test OWNER postgres'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'gonurse_benchmark_test')
\gexec

REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;
REVOKE CONNECT ON DATABASE gonurse_app FROM PUBLIC;
REVOKE CONNECT ON DATABASE gonurse_app_test FROM PUBLIC;
REVOKE CONNECT ON DATABASE gonurse_benchmark FROM PUBLIC;
REVOKE CONNECT ON DATABASE gonurse_benchmark_test FROM PUBLIC;
REVOKE CONNECT ON DATABASE gonurse_benchmark FROM gonurse_benchmark_test;
REVOKE CREATE ON DATABASE gonurse_benchmark FROM gonurse_benchmark_test;
GRANT CONNECT ON DATABASE gonurse_app TO gonurse_app;
GRANT CONNECT ON DATABASE gonurse_app_test TO gonurse_app_test;
GRANT CREATE ON DATABASE gonurse_app_test TO gonurse_app_test;
GRANT CONNECT ON DATABASE gonurse_benchmark TO gonurse_benchmark;
GRANT CONNECT ON DATABASE gonurse_benchmark_test TO gonurse_benchmark_test;
GRANT CREATE ON DATABASE gonurse_benchmark_test TO gonurse_benchmark_test;
SQL

psql --username "$POSTGRES_USER" --dbname gonurse_app --set=ON_ERROR_STOP=1 <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SQL

psql --username "$POSTGRES_USER" --dbname gonurse_app_test --set=ON_ERROR_STOP=1 <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SQL

psql --username "$POSTGRES_USER" --dbname gonurse_benchmark --set=ON_ERROR_STOP=1 <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM gonurse_benchmark_test;
GRANT USAGE ON SCHEMA public TO gonurse_benchmark;
SQL

psql --username "$POSTGRES_USER" --dbname gonurse_benchmark_test --set=ON_ERROR_STOP=1 <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO gonurse_benchmark_test;
SQL
