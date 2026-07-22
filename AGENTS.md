# AGENTS.md

## Cursor Cloud specific instructions

Project = **GuestyMigrate**: React 18 + Vite frontend (`client/`) and an Express + PostgreSQL backend (`server/`). Redis, Stripe, and Resend are all optional (the app degrades gracefully without them). There is also a separate secondary microservice in `guesty-rate-strategy-migrator/` (see its own `README.md`) — it is not part of the main app's dev flow and its dependencies are not installed by the root `npm install`.

Standard commands live in `README.md` / `CONTRIBUTING.md` / `package.json` scripts. Notes below are the non-obvious things.

### Services must be started manually each session
PostgreSQL and Redis are installed as system packages but are NOT managed by systemd in this VM, so they do not auto-start on boot. Start them at the beginning of a session if they aren't already running:

```bash
sudo pg_ctlcluster 16 main start   # PostgreSQL on :5432
sudo redis-server --daemonize yes  # Redis on :6379 (optional)
```

Verify: `sudo pg_lsclusters` (should show `online`) and `redis-cli ping` (should print `PONG`).

### Environment file
`.env` is git-ignored and already created on disk with local dev values (local Postgres URL, generated `JWT_SECRET`/`ENCRYPTION_KEY`, `REDIS_URL`, `NODE_ENV=development`, `FRONTEND_URL=http://localhost:5173`). The backend hard-exits at startup if `DATABASE_URL`, `JWT_SECRET`, or `ENCRYPTION_KEY` are missing. If `.env` is ever lost, recreate it from `.env.example`; generate the encryption key with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. The local DB is `guesty_migrate` owned by role `guesty`/`guesty`.

### Ports (README is out of date)
`npm run dev` runs backend (nodemon) on **:3001** and the Vite frontend on **:5000** (configured in `client/vite.config.ts`), NOT :5173 as the README states. Vite proxies `/api` → `http://localhost:3001`. Open the app at `http://localhost:5000/`. Backend health: `GET http://localhost:3001/api/health`. Swagger docs: `http://localhost:3001/api/docs`.

### Database migrations
`npm run db:migrate` is idempotent (all `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`) and also runs automatically on server startup, so you rarely need to run it by hand.

### Tests
- `npm test` — backend Jest suite. Fully mocks `server/db` and `server/queue`, so it needs NO running Postgres/Redis. Currently 158 passing.
- `npm run test:client` — client Vitest. 3 tests in `client/src/context/AuthContext.test.tsx` fail on a fresh clone (mocked-axios/localStorage hydration mismatch, environment-independent) — treat as a pre-existing failure, not a setup problem.
- `npm run test:e2e` — Playwright; requires the dev server running and Playwright browsers installed (`npx playwright install`), not part of standard setup.
- No linter is configured (no ESLint / `lint` script).
