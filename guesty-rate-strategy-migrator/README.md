# guesty-rate-strategy-migrator

A production-grade Node.js/TypeScript microservice that copies **Rate Strategies** from one Guesty account to another using Playwright browser automation.

## Why browser automation?

Guesty's Open API (`open-api.guesty.com`) has no `POST /rate-strategies` endpoint. Strategies can be read via `GET /v1/revenue-management/rate-strategies` but must be *created* by interacting with the Guesty web dashboard. This service bridges that gap by:

1. Fetching source strategies via the Open API (structured, reliable).
2. Logging into the destination account via a Playwright-controlled browser.
3. Recreating each strategy and its rules through the Guesty UI.

---

## Architecture

```
POST /api/v1/migrations
   │
   ├─ Zod request validation
   ├─ AES-256-GCM credential encryption
   ├─ Write initial 'queued' record to PostgreSQL
   └─ Enqueue Bull job (Redis)
         │
         └─ Worker picks up job
               ├─ Decrypt credentials in-memory
               ├─ Fetch strategies via Guesty Open API (OAuth2)
               ├─ Optional: UI validation cross-check
               ├─ Playwright: login to destination account
               ├─ Playwright: recreate each strategy + rules
               └─ Write final status to PostgreSQL
```

Job history is stored in PostgreSQL (`rate_strategy_migrator.job_history`) and survives Redis restarts. Redis holds the live queue; PostgreSQL holds the permanent record.

---

## Prerequisites

- Node.js 20+
- Redis (for Bull queue)
- PostgreSQL (for job history)
- npm

---

## Local setup

### 1. Install dependencies

```bash
cd guesty-rate-strategy-migrator
npm install
```

Playwright downloads Chromium automatically during `npm install` via `@playwright/test`.

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` — see the section below for required values.

### 3. Run the database migration

```bash
npm run db:migrate
```

This creates the `rate_strategy_migrator` schema and `job_history` table in your PostgreSQL database. The command is idempotent — safe to run multiple times.

### 4. Start in development mode

```bash
npm run dev
```

The server starts on `PORT` (default: 3000) with TypeScript hot-reload.

### 5. Build and start in production mode

```bash
npm run build
npm start
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string (e.g. `postgresql://user:pass@host:5432/db`) |
| `REDIS_URL` | Yes | Redis connection string (e.g. `redis://localhost:6379`) |
| `PAYLOAD_ENCRYPTION_KEY` | Yes | 32-byte hex key for AES-256-GCM credential encryption |
| `PORT` | No | HTTP port (default: `3000`) |
| `HEADLESS` | No | Set to `false` to show the browser window (default: `true`) |
| `BROWSER_TIMEOUT_MS` | No | Per-action Playwright timeout in ms (default: `15000`) |
| `JOB_TIMEOUT_MS` | No | Full job timeout in ms (default: `600000` = 10 min) |
| `LOG_LEVEL` | No | Pino log level: `trace` / `debug` / `info` / `warn` / `error` (default: `info`) |
| `ENABLE_UI_VALIDATION` | No | Set to `true` to cross-check Open API strategy count against the Guesty UI (default: `false`) |
| `GUESTY_APP_URL` | No | Guesty dashboard base URL (default: `https://app.guesty.com`) |

### Generating the encryption key

```bash
openssl rand -hex 32
```

Copy the output into `.env` as the value of `PAYLOAD_ENCRYPTION_KEY`.

---

## Credential security

**Never pass credentials in query parameters, URLs, or log output.**

All credentials flow only through:
- The request body over HTTPS (to `POST /api/v1/migrations`)
- AES-256-GCM encrypted fields in the Bull job payload
- In-memory decryption immediately before Playwright use — never written to disk or database

The `pino` logger is configured with a `redact` list that automatically censors `password`, `email`, `token`, `clientSecret`, and related fields in all structured log output.

---

## API

### `POST /api/v1/migrations`

Triggers a new rate strategy migration job.

**Rate limit:** 5 requests per minute per IP.

**Request body:**
```json
{
  "sourceClientId":     "guesty-client-id",
  "sourceClientSecret": "guesty-client-secret",
  "sourceEmail":        "admin@source-account.com",
  "sourcePassword":     "...",
  "destEmail":          "admin@dest-account.com",
  "destPassword":       "..."
}
```

**Response (202):**
```json
{ "jobId": "uuid", "status": "queued" }
```

---

### `GET /api/v1/migrations/:jobId`

Returns the current status of a specific job. Reads from PostgreSQL — survives Redis eviction.

**Response:**
```json
{
  "jobId":          "uuid",
  "status":         "completed",
  "triggeredAt":    "2024-01-01T12:00:00.000Z",
  "completedAt":    "2024-01-01T12:03:22.000Z",
  "durationMs":     202000,
  "strategyCount":  5,
  "migratedCount":  5,
  "failedCount":    0,
  "errors":         null,
  "sourceClientId": "guesty-client-id"
}
```

**Status values:** `queued` | `running` | `completed` | `failed` | `partial`

---

### `GET /api/v1/migrations`

Lists job history, most recent first. Supports pagination.

**Query params:** `?limit=20&offset=0`

**Response:**
```json
{ "jobs": [...], "limit": 20, "offset": 0 }
```

---

### `GET /health`

Returns `{ "status": "ok", "timestamp": "..." }`.

---

## Running with Docker

```bash
# Build
docker build -t guesty-rate-strategy-migrator .

# Run
docker run -d \
  -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/db" \
  -e REDIS_URL="redis://redis:6379" \
  -e PAYLOAD_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  -e NODE_ENV=production \
  guesty-rate-strategy-migrator
```

The Dockerfile uses `mcr.microsoft.com/playwright:v1.44.0-noble` as the base image, which includes all Chromium system dependencies pre-installed. It runs as the built-in non-root `pwuser`, ensuring the Chrome sandbox works correctly without `--no-sandbox`.

---

## Running tests

```bash
npm test
```

Tests use `@playwright/test` with `context.route()` to mock the Guesty login page — no real credentials or network access needed.

---

## Known limitations

### No Guesty Open API write endpoint for Rate Strategies

`GET /v1/revenue-management/rate-strategies` is available and used by this service to extract strategies. However, Guesty's Open API has **no `POST /rate-strategies` endpoint**. Strategy creation can only be done through the Guesty web dashboard. This service automates that interaction using Playwright.

**This means:** If Guesty updates their dashboard UI, the Playwright selectors used in `src/migrator/createStrategies.ts` may break.

### Guesty UI selector maintenance

If a migration fails with an error like `Timeout waiting for locator` or `UIChangedError`, it means a Guesty UI update has changed the button text, input label, or page structure. To fix:

1. Run the service locally with `HEADLESS=false` to see the browser.
2. Inspect the current Guesty UI for the changed element.
3. Update the matching selector in `src/migrator/createStrategies.ts`.
4. Resilience-first selectors to prefer: `getByRole`, `getByLabel`, `getByText`, `getByTestId`. Avoid `nth()` positional selectors.

### 2FA not supported

If 2FA is enabled on either Guesty account, automated login will fail with a `LoginFailedError`. Disable 2FA on the accounts used for migration, or use a dedicated migration service account without 2FA.

### Partial migrations

If some strategies succeed and others fail, the job status is set to `partial`. Successfully created strategies are NOT rolled back. The `errors` field in the job record lists which strategies and rules failed, so you can retry only the failed ones.
