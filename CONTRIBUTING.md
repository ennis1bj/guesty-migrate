# Contributing to GuestyMigrate

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Prerequisites

- **Node.js 18+** (20 recommended)
- **PostgreSQL** (local instance or hosted)
- **npm** (comes with Node.js)
- **Redis** (optional — the app falls back to in-process job execution)

## Local Development Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/ennis1bj/guesty-migrate.git
   cd guesty-migrate
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

   This also installs client dependencies via the `postinstall` script.

3. **Configure environment variables**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your local PostgreSQL connection string, JWT secret, and encryption key. See `.env.example` for all available options.

4. **Start the development servers**

   ```bash
   npm run dev
   ```

   - Frontend: `http://localhost:5173` (Vite with HMR)
   - Backend: `http://localhost:3001`
   - API docs: `http://localhost:3001/api/docs`

## Running Tests

### Unit / Integration Tests (Jest)

```bash
npm test

# With coverage
npm run test:coverage
```

### End-to-End Tests (Playwright)

```bash
npx playwright test
```

Make sure the dev server is running before executing E2E tests.

## Code Style

- Follow the existing patterns in the codebase
- Use TypeScript for all client-side code
- Use ES modules (import/export) in client code
- Use CommonJS (require) in server code
- Keep components focused and reasonably sized
- Use meaningful variable and function names

## Pull Request Process

1. **Branch from `main`** — create a descriptive branch name (e.g., `fix/pricing-display`, `feat/add-export`)
2. **Write descriptive commits** — explain _why_, not just _what_
3. **Include tests** — add or update tests for any new functionality
4. **Verify locally** — run `npm test` and confirm the app works end-to-end
5. **Open a PR against `main`** — include a summary of changes and any testing notes
6. **Address review feedback** — keep the conversation constructive

## Reporting Issues

Open a GitHub issue with a clear title and description. Include steps to reproduce for bugs, or a use case description for feature requests.
