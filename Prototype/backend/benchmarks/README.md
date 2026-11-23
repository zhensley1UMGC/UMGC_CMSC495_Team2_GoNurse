# Synthetic recommendation-ranker benchmark

This manually run benchmark compares the existing deterministic
recommendation ranker with an OpenAI-compatible embedding candidate stored and
queried through pgvector, plus three fixed hybrid hypotheses. It is an
engineering measurement on fabricated data, not a production ranker or a
release gate. It does not call the recommendation API, alter application
tables, or change live ranking behavior.

## Dataset and relevance rubric

`data/ranker_cases.json` contains 25 fabricated profiles, 100 fabricated
opportunities, and an explicit integer grade from 0 to 3 for each of the 2,500
profile/opportunity pairs. The loader verifies unique IDs, all pair labels,
grade bounds, references, known case tags, and coverage of the required
scenarios before a run. The file is the source of truth; labels and data are
checked in, while embeddings and run output are not.

The grades mean:

| Grade | Meaning |
| --- | --- |
| 0 | Not relevant |
| 1 | Weak or adjacent |
| 2 | Useful |
| 3 | Highly relevant |

These are synthetic-annotator judgments about opportunity relevance, not
eligibility. For this fixed set, the synthetic annotator gives two points for
an overlapping required skill and one point for an overlapping interest, with
the result capped at 3. The only equivalence in the annotation rule is
`critical care` / `ICU`. It deliberately permits a relevant label even when
exact-skill eligibility later excludes that listing. Labels were checked
against the rubric, the pair matrix, and targeted opt-out, status, skill,
schedule, no-match, ordering, and synonym scenarios. This mechanically
generated rubric is not a substitute for clinical or human relevance review.

Profiles carry scenario tags for opt-out, open/closed status, exact skill
matching, missing skills, matching and nonmatching availability, eligible
no-match cases, ordering among several eligible listings, and a relevant
`critical care` / `ICU` synonym whose exact skill gate fails.

## Eligibility and candidates

Every candidate receives the same eligibility set for each query:

* **`strict`:** profile opt-in is required; only `open` opportunities remain;
  all normalized required skills must match exactly, case-insensitively; and
  at least one normalized availability value must overlap when an opportunity
  specifies availability. An empty opportunity schedule is unrestricted.
  This matches the existing ranker's skill/schedule conditions and the API's
  outer opt-in/open-status gates.

The deterministic candidate calls `app.services.recommendations.rank()` on
the prefiltered opportunities without modifying it. Embedding-only cosine
ordering and the hybrid candidates use the same eligibility set. Any final
score tie is ordered by `(title.casefold(), opportunity_id)`.

The fixed hybrid candidates are:

1. Equal-weight sum of min-max-normalized deterministic and cosine scores.
   Cosine is mapped from `[-1, 1]` to `[0, 1]`; constant deterministic score
   sets normalize to `0`.
2. Deterministic score descending, with cosine descending as the secondary
   key.
3. Reciprocal-rank fusion with `1 / (60 + rank)` for each of the deterministic
   and semantic orderings.

Weights and the RRF constant are declared before evaluation and are not tuned
on the labeled set. No candidate winner or significance threshold is selected.

## Metrics and repeatability

Metrics are calculated for each profile query and macro-averaged across
queries; the same macro averages are reported for each scenario category:

* `Precision@5` is grade>=2 results among the first five divided by five.
  Unfilled result positions count as nonrelevant.
* `Recall@5` is grade>=2 results in the first five divided by the number of
  grade>=2 opportunities in that mode's eligible pool. When that pool has no
  grade>=2 items, recall is 1 only for an empty result and 0 otherwise.
* `NDCG@5` uses graded gain `2^grade - 1`, discounted by `log2(rank + 1)` for
  1-based rank, and the ideal ordering from the same eligible pool. When the
  ideal DCG is zero, it uses the same correct-empty convention.
* `no_match_exact_empty_rate` is the fraction of queries with an empty
  grade>=2 eligible pool for which the candidate returned exactly no results.

Ineligible labels never count as retrievable relevance. Quality metrics are
deterministic for identical data, model vectors, and tie rules. Provider
latency, database timings, reported token use, and cost are observations and
can vary by cache, machine, or provider. Query p50/p95 use nearest-rank
percentiles. Embedding generation and vector/index build times are recorded
separately. A missing provider-reported token count or missing operator-supplied
price results in cost being marked unavailable, not estimated.

## Setup and safe execution

Run the command from `Prototype/backend`. Install both the normal pinned
requirements and the optional benchmark lock:

```shell
python -m pip install -r requirements.txt -r requirements-benchmark.txt
python -m benchmarks.run
```

The optional lock is compiled from `requirements.in` plus the benchmark-only
`pgvector` package. To regenerate it with Python 3.12 and `uv==0.9.26`, run
from `Prototype/backend`:

```shell
uv pip compile --python 3.12 --python-version 3.12 --universal --no-header requirements-benchmark.in -o requirements-benchmark.txt
```

The remote embedder uses existing `httpx`; it does not depend on the chat
provider or add a provider SDK. Configure these values in `Prototype/backend/.env`
or the process environment. Process environment values take precedence. These
settings are separate from `GONURSE_AI_*`; the benchmark never uses the chat
API key or model automatically:

| Variable | Purpose | Default |
| --- | --- | --- |
| `GONURSE_EMBEDDING_BASE_URL` | OpenAI-compatible API base, including `/v1` where required | `https://api.openai.com/v1` |
| `GONURSE_EMBEDDING_MODEL` | Exact embedding model identifier | Required |
| `GONURSE_EMBEDDING_API_KEY` | Bearer key for the embedding endpoint | Required |
| `GONURSE_EMBEDDING_TIMEOUT_SECONDS` | Positive per-operation timeout, at most 300 seconds | `30` |
| `GONURSE_EMBEDDING_PRICE_PER_1M_TOKENS` | Optional operator-supplied input-token price | Unset |

Use synthetic text only. Credentials are sent in the authorization header and
are not printed or written to results. The HTTP client disables redirects and
environment-configured proxies; HTTPS is required except for loopback hosts.
The benchmark does not silently switch provider, model, or embedder if a
configuration or request fails.

The pgvector candidate requires a **dedicated benchmark database**. Do not use
the application database. Provision the database separately, then explicitly
install the `vector` extension there using the database administrator's normal
process before running the benchmark. The benchmark checks for the extension
and never runs `CREATE EXTENSION`. It does not inspect, create, migrate, or
query application tables.

Set `GONURSE_BENCHMARK_DATABASE_URL` in `.env` or the process environment to
the dedicated database's `postgresql+psycopg://` connection URL. For backward
compatibility, process `DATABASE_URL` is used only when
`GONURSE_BENCHMARK_DATABASE_URL` is absent; `DATABASE_URL` in `.env` is not
used by the benchmark. Set `GONURSE_BENCHMARK_ALLOW_SCHEMA_CREATE=YES` only
after confirming the target is dedicated and benchmark schema creation is
permitted. The runner prints a
warning before connecting. It creates a UUID-named `rankbench_*` schema with
only benchmark-owned vector tables/indexes, and drops only that schema on
normal or exceptional completion. The explicit variable is a confirmation,
not an automated way to establish that a database is dedicated.

When the provider is not configured, the database guard is absent, or pgvector
is unavailable, the deterministic results still run. Embedding and hybrid
candidates are shown as **skipped** with the reason in the console and JSON;
the run is marked `partial`, never a complete comparison. Database setup/query
errors fail the optional candidates explicitly without recording connection
details. The offline unit tests use `FakeEmbedder` and make no network or
database calls. They do not need pgvector installed.

## Text fields, cache, and output

Embedding input uses only the following fields, in the shown order:

* Profile: skills, interests, availability.
* Opportunity: title, description, category, required skills, interests,
  availability.

Each value is stripped, whitespace-collapsed, and case-folded. Each list is
normalized the same way, sorted case-insensitively, and joined with `, `. Field
labels and newlines are fixed by `profile_text()` and `opportunity_text()`.
IDs, opt-in, and opportunity status are not embedded; they remain structured
gates. This composition is a benchmark input for future design work, not a
production embedding contract.

Vectors are cached in SQLite at
`Prototype/backend/.benchmark-cache/embeddings.sqlite3`, keyed by a SHA-256
identity of the embedding endpoint and exact model identifier plus a SHA-256
of canonical text, with dimension checks. Existing model-only cache entries
are not reused. Result
JSON is written under `Prototype/backend/.benchmark-results/` with a UTC
timestamp. Both directories are ignored by Git. Results include dataset hash,
model, commit, working-tree dirty status, timestamp, formulas, strict metrics, category
breakdowns, latency, usage/cost availability, cache counts, and skip/status
information. They do not contain raw prompts, vectors, credentials, provider
response bodies, or non-synthetic input.
Dirty status is `null` if Git is unavailable. A dirty result identifies the
base commit but does not capture uncommitted changes; commit changes before a
run if the result must be reproducible from Git alone.

The adapter creates an HNSW cosine index for vectors up to 2,000 dimensions.
For larger vectors it creates a model/dimension B-tree index and still computes
exact cosine distances with pgvector; the selected index strategy is recorded
in the structured results.

## Limitations

This small, rule-labeled synthetic dataset cannot establish real-world clinical
relevance, model quality, production cost, privacy compliance, provider
availability, or a production performance threshold. Do not interpret the
results as validation for real profiles or listings. A later production
decision must separately approve its data fields, provider/model, refresh and
failure behavior, eligibility policy, and operational safeguards. CI runs
offline tests only; it does not call a remote provider or run the benchmark.
