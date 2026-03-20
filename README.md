# GuestyMigrate

Self-serve migration tool for transferring data between Guesty.com property management accounts via the Guesty Open API.

## What It Does

GuestyMigrate lets property managers migrate all their data from one Guesty account to another — fully automated. It handles:

- **Custom Fields** — custom field definitions
- **Rate Strategies** — pricing rules, seasonal rates, and base pricing configurations
- **Fees** — fee structures
- **Taxes** — tax configurations
- **Listings** — property configurations, details, photos, and complex (MTL) parent-child relationships
- **Guests** — guest profiles and contact information (with 409 deduplication)
- **Owners** — property owner records
- **Saved Replies** — message templates with listing-scoped remapping
- **Reservations** — direct/manual bookings with listing and guest ID remapping (channel reservations are skipped)
- **Automations** — workflow automation rules with listing ID remapping
- **Tasks** — task assignments with listing ID remapping (created unassigned)
- **Photos** — native listing photos uploaded to destination (channel-managed photos are skipped)
- **Calendar Blocks** — manual availability blocks transferred per listing

The migration engine respects dependency ordering (rate strategies → listings → reservations), handles API rate limits, recovers from partial failures, and produces a verification diff report when complete.

### Complex Listing (MTL) Support

GuestyMigrate automatically detects Multi-Unit/Complex listing hierarchies. Parent listings are migrated before sub-units, and `parentId` references are remapped to preserve the full parent-child structure in the destination account.

## Screenshots

### Step 1: Connect Your Accounts
![Connect credentials](docs/screenshots/step-connect.png)
Enter your source and destination Guesty Open API credentials. Both accounts are validated instantly before proceeding.

### Step 2: Review Your Data
![Review manifest](docs/screenshots/step-review.png)
See a full manifest of your source account — listing counts, guests, reservations, automations, and more. Select or deselect categories as needed.

### Step 3: Pay & Configure
![Payment and pricing](docs/screenshots/step-payment.png)
Choose flat-rate or per-listing pricing. Add optional add-ons like priority processing or a post-migration verify call. Pay securely via Stripe.

### Step 4: Migrate & Verify
![Migration progress](docs/screenshots/step-progress.png)
Watch real-time progress as each category migrates. When complete, review the verification diff report confirming source-to-destination counts match.

### Verification Report
![Diff report](docs/screenshots/diff-report.png)
A detailed report comparing source and destination counts for every category, including photo migration stats and calendar block transfers.

## Who It's For

Property managers switching between Guesty accounts, agencies managing multiple Guesty accounts, or anyone who needs to consolidate or split Guesty account data.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  React SPA  │────▶│  Express API │────▶│ PostgreSQL  │
│  (Vite)     │     │              │     │             │
└─────────────┘     │  - Auth      │     └─────────────┘
                    │  - Migrations│
                    │  - Webhooks  │     ┌─────────────┐
                    │              │────▶│ Redis/BullMQ│
                    └──────────────┘     │ (optional)  │
                           │             └─────────────┘
                           │
                    ┌──────┴──────┐
                    │   Guesty    │
                    │  Open API   │
                    └─────────────┘
```

- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS
- **Backend**: Node.js + Express
- **Database**: PostgreSQL (via node-postgres with connection pooling)
- **Job Queue**: BullMQ + Redis (falls back to in-process execution if Redis is unavailable)
- **Payments**: Stripe Checkout
- **Email**: Resend (falls back to console logging)
- **Auth**: JWT with bcryptjs password hashing, email verification, password reset
- **Encryption**: AES-256-CBC for all credentials at rest (client IDs, secrets, and OAuth tokens)
- **Logging**: Structured JSON logging with request correlation IDs
- **API Docs**: OpenAPI/Swagger at `/api/docs` (development)

## Running Locally

### Prerequisites

- Node.js 20+
- PostgreSQL
- Redis (optional — the app works without it)

### Setup

```bash
# Clone the repository
git clone https://github.com/ennis1bj/guesty-migrate.git
cd guesty-migrate

# Copy environment variables
cp .env.example .env
# Edit .env with your actual values

# Install all dependencies (root + client via postinstall)
npm install

# Run database migrations (auto-runs on server start)
npm run db:migrate

# Start development servers (backend + frontend)
npm run dev
```

The frontend runs on `http://localhost:5173` and the backend on `http://localhost:3001`. The Vite dev server proxies `/api` requests to the backend.

API documentation is available at `http://localhost:3001/api/docs` in development mode.

## Creating an Admin Account

To create the first admin user for managing beta access and invoices:

```bash
node server/scripts/create-admin.js admin@example.com yourpassword
```

This creates a verified admin account that can access `/admin` in the dashboard.

## Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage
```

## Running in Production

```bash
# Build the frontend
npm run build

# Start the production server
npm run start
```

Express serves the built frontend from `client/dist` for all non-API routes.

## Deploying to Replit

1. Create a new Replit from this GitHub repository
2. Add environment variables in **Replit Secrets** (see `.env.example`)
3. Set the run command to:
   ```
   npm run build && npm run start
   ```
4. **Database**: Use Replit's built-in PostgreSQL, or an external provider like [Neon](https://neon.tech) or [Supabase](https://supabase.com)
5. **Redis**: Optional. If `REDIS_URL` is not set, the app falls back to in-process job execution (works fine for single-instance deployments)

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3001) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret key for JWT token signing |
| `ENCRYPTION_KEY` | 32-byte hex key for AES-256 credential encryption |
| `STRIPE_SECRET_KEY` | Stripe secret key (sk_test_...) |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (pk_test_...) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (whsec_...) |
| `RESEND_API_KEY` | Resend API key for email (optional) |
| `REDIS_URL` | Redis connection URL (optional) |
| `FRONTEND_URL` | Frontend URL for CORS and redirects |
| `FROM_EMAIL` | Sender email for migration reports (default: noreply@guestymigrate.com) |
| `LOG_LEVEL` | Logging level: debug, info, warn, error (default: info) |

## Configuring Stripe

1. Create a [Stripe account](https://dashboard.stripe.com) and get your API keys
2. Set `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` in your environment
3. Set up a webhook endpoint:
   - URL: `https://your-domain.com/api/webhooks/stripe`
   - Events: `checkout.session.completed`
4. Copy the webhook signing secret to `STRIPE_WEBHOOK_SECRET`

### Pricing Tiers

| Listings | Price |
|----------|-------|
| 1 – 10   | $39 + $12/listing (capped at $149) |
| 11 – 50  | $349  |
| 51 – 150 | $699  |
| 151 – 300| $999  |
| 301 – 500| $1,499|
| 500+     | Custom|

Alternatively, customers can choose per-listing graduated pricing at checkout:
- Base fee: $79
- Listings 1–50: $8.00/listing
- Listings 51–200: $5.00/listing
- Listings 201+: $3.00/listing

## API Documentation

In development mode, interactive API documentation (Swagger UI) is available at `/api/docs`. The raw OpenAPI spec can be accessed at `/api/docs/spec.json`.

## GDPR / Data Subject Rights

GuestyMigrate provides the following endpoints for GDPR compliance:

- `GET /api/auth/export` — Export all user data in JSON format (requires authentication)
- `DELETE /api/auth/account` — Delete account and all associated data with proper cascade (requires authentication)

## Obtaining Guesty Open API Credentials

1. Log in to your [Guesty Dashboard](https://app.guesty.com)
2. Navigate to **Marketplace** → **Development Tools** → **Open API**
3. Create an API client with the required scopes
4. Note your **Client ID** and **Client Secret**
5. Repeat for both source and destination accounts

API documentation: [Guesty Open API Docs](https://open-api.guesty.com/api)

## Legal

- [Terms of Service](TERMS.md)
- [Privacy Policy](PRIVACY.md)

## License

MIT — see [LICENSE](LICENSE) for details.
