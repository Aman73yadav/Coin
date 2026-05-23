# Crypto Transaction Reconciliation Engine

A production-grade Node.js service that ingests two sources of crypto transaction
data (user-exported and exchange-exported), matches them using configurable
tolerances, and produces a structured reconciliation report.

---

## Quick Start

```bash
npm install
npm start                       # start the API server on :3000
node src/test.js                # run a full reconciliation against sample data
node src/test.js --strict       # tighten tolerances (reveals CONFLICTING rows)
node src/test.js --loose        # loosen tolerances
```

The server picks up bundled sample CSVs from `data/` automatically.

---

## Architecture

```
reconciliation-engine/
├── config.json                 Default tolerances & DB settings
├── data/
│   ├── user_transactions.csv
│   └── exchange_transactions.csv
├── output/                     Generated report CSVs land here
└── src/
    ├── index.js                Entry point: boot DB → start Express
    ├── config.js               Config resolution (defaults < file < env < request)
    ├── api/
    │   ├── app.js              Express app factory
    │   └── routes.js           REST endpoints
    ├── db/
    │   ├── index.js            DB factory (selects driver by DB_DRIVER config)
    │   ├── memory.js           In-memory driver (default, no deps)
    │   └── mongodb.js          MongoDB driver (native client, no Mongoose)
    ├── ingestion/
    │   └── parser.js           CSV parsing + per-row data quality validation
    ├── matching/
    │   ├── aliases.js          Asset normalisation & type flip map
    │   └── engine.js           Proximity matching algorithm
    ├── reporting/
    │   └── generator.js        CSV/JSON report builder + summary
    └── services/
        └── reconciler.js       Orchestrator: parse → store → match → persist → summarise
```

---

## Configuration

Tolerances are resolved in priority order: **request body → env vars → config.json → defaults**.

| Key | Default | Description |
|-----|---------|-------------|
| `TIMESTAMP_TOLERANCE_SECONDS` | `300` | Max timestamp delta (seconds) for a match |
| `QUANTITY_TOLERANCE_PCT` | `0.01` | Max relative quantity delta (fraction, e.g. 0.01 = 1%) |
| `DB_DRIVER` | `memory` | `memory` or `mongodb` |
| `MONGODB_URI` | `mongodb://localhost:27017/reconciliation` | Mongo connection string |
| `PORT` | `3000` | HTTP listen port |

### Environment variables

```bash
TIMESTAMP_TOLERANCE_SECONDS=60 QUANTITY_TOLERANCE_PCT=0.001 npm start
```

### config.json (committed defaults)

```json
{
  "TIMESTAMP_TOLERANCE_SECONDS": 300,
  "QUANTITY_TOLERANCE_PCT": 0.01,
  "DB_DRIVER": "memory"
}
```

### Per-request overrides

```bash
curl -X POST http://localhost:3000/reconcile \
  -H 'Content-Type: application/json' \
  -d '{"TIMESTAMP_TOLERANCE_SECONDS": 30, "QUANTITY_TOLERANCE_PCT": 0.001}'
```

---

## REST API

### `POST /reconcile`

Trigger a reconciliation run. Returns a run summary immediately.

**Request body (all optional):**
```json
{
  "userFile":     "/absolute/path/to/user_transactions.csv",
  "exchangeFile": "/absolute/path/to/exchange_transactions.csv",
  "TIMESTAMP_TOLERANCE_SECONDS": 300,
  "QUANTITY_TOLERANCE_PCT": 0.01
}
```

**Response `202`:**
```json
{
  "runId": "92d0dc08-...",
  "status": "completed",
  "config": { "TIMESTAMP_TOLERANCE_SECONDS": 300, ... },
  "summary": {
    "matched": 22,
    "conflicting": 0,
    "unmatched_user": 0,
    "unmatched_exchange": 3,
    "total_results": 25,
    "flagged_user": 4,
    "flagged_exchange": 0
  }
}
```

---

### `GET /report/:runId`

Full reconciliation report. Filter by category with `?category=MATCHED,CONFLICTING`.

Add header `Accept: text/csv` to receive a downloadable CSV.

---

### `GET /report/:runId/summary`

Counts only: matched / conflicting / unmatched / flagged.

---

### `GET /report/:runId/unmatched`

Only `UNMATCHED_USER` and `UNMATCHED_EXCHANGE` rows with reasons.
Accepts `Accept: text/csv`.

---

### `GET /report/:runId/flagged`

Rows excluded from matching due to data quality failures (bad timestamp,
negative quantity, duplicate ID, missing required field).
Accepts `Accept: text/csv`.

---

### `GET /health`

Liveness probe. Returns `{ "status": "ok" }`.

---

## Matching Algorithm

### Phase 1 — Asset & type gating

Only exchange rows with the same normalised asset and a compatible type are
considered as candidates for a given user row.

**Asset aliases handled:**

| Alias | Canonical |
|-------|-----------|
| `bitcoin` | `BTC` |
| `ethereum` | `ETH` |
| `solana` | `SOL` |
| `polygon` | `MATIC` |
| `chainlink` | `LINK` |
| `tether` | `USDT` |

**Type perspective flips:**

| User side | Exchange side |
|-----------|---------------|
| `TRANSFER_OUT` | `TRANSFER_IN` |
| `WITHDRAWAL` | `DEPOSIT` |

### Phase 2 — Tolerance filtering

From the candidates, rows within BOTH tolerances are "within-tolerance" matches:

```
|timestamp_user − timestamp_exchange| ≤ TIMESTAMP_TOLERANCE_SECONDS
|qty_user − qty_exchange| / max(|qty_user|, |qty_exchange|) ≤ QUANTITY_TOLERANCE_PCT
```

The best within-tolerance match (smallest `|Δt|`) is chosen. This prevents
false ambiguous matches when two transactions of the same asset type occur
close together in time.

### Phase 3 — Conflict detection

If candidates exist but none are within tolerance, the closest one is reported
as **CONFLICTING** (matched by proximity but key fields differ beyond tolerance).

### Phase 4 — Leftovers

Any user row with no matching exchange candidate at all → **UNMATCHED_USER**.
Any exchange row not consumed by matching → **UNMATCHED_EXCHANGE**.

---

## Data Quality Rules

The ingestion layer validates every row **before** matching. Flagged rows are
**never silently dropped** — they are stored with their issues and surfaced in
`/report/:runId/flagged`.

| Check | Severity | Effect |
|-------|----------|--------|
| Missing required field (`transaction_id`, `timestamp`, `asset`, `quantity`) | Fatal | Row excluded from matching |
| Missing `type` | Warning | Row excluded from matching |
| Duplicate `transaction_id` within same file | Fatal | Duplicate excluded |
| Unparseable/incomplete timestamp (e.g. `2024-03-09T`) | Fatal | Row excluded |
| Negative quantity | Fatal | Row excluded |
| Zero quantity | Warning | Row included with warning |
| Non-numeric `price_usd` or `fee` | Warning | Field treated as null |

---

## Report Categories

| Category | Meaning |
|----------|---------|
| `MATCHED` | Paired across both sources within all tolerances |
| `CONFLICTING` | Same asset+type proximity candidate exists but Δt or Δqty exceeds tolerance |
| `UNMATCHED_USER` | Present in user file; no matching exchange record found |
| `UNMATCHED_EXCHANGE` | Present in exchange file; no matching user record found |

---

## Using MongoDB

```bash
# Start Mongo (Docker example)
docker run -d -p 27017:27017 --name mongo mongo:7

# Point the engine at it
DB_DRIVER=mongodb MONGODB_URI=mongodb://localhost:27017/reconciliation npm start
```

The MongoDB driver automatically creates indexes on `runId` and `category`
for efficient report fetching. If MongoDB is unavailable at startup, the engine
falls back to the in-memory store with a warning.

---

## Sample Data Issues (what the engine finds)

| Row | Source | Issue |
|-----|--------|-------|
| USR-001 (line 17) | User | Duplicate `transaction_id` |
| USR-018 | User | Malformed timestamp `2024-03-09T` (missing time part) |
| USR-019 | User | Negative quantity `-0.10` |
| USR-024 | User | Missing `type` field + malformed timestamp |
| USR-005 | User | Asset `bitcoin` aliased → `BTC` (matched successfully) |
| USR-004/009/016 | User | `TRANSFER_OUT` flipped to match exchange `TRANSFER_IN` |
| USR-012 vs EXC-1012 | Both | Qty `0.30` vs `0.3001` — within 0.01% default tolerance |
| EXC-1018 | Exchange | Counterpart USR-018 has bad timestamp → unmatched |
| EXC-1024, EXC-1025 | Exchange | No user record exists → unmatched |
