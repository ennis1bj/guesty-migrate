# GuestyMigrate

Self-serve migration tool for transferring data between Guesty.com property management accounts via the Guesty Open API.

## What It Does

GuestyMigrate lets property managers migrate all their data from one Guesty account to another — fully automated. It handles:

- **Listings** — property configurations and details
- **Guests** — guest profiles and contact information
- **Owners** — property owner records
- **Reservations** — bookings with listing and guest ID remapping
- **Automations** — workflow automation rules
- **Tasks** — task assignments with listing ID remapping

The migration engine respects dependency ordering (listings before reservations), handles API rate limits, recovers from partial failures, and produces a verification diff report when complete.

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
- **Email**: SendGrid via Nodemailer (falls back to console logging)
- **Auth**: JWT with bcryptjs password hashing
- **Encryption**: AES-256-CBC for API credentials at rest

## Running Locally

### Prerequisites

- Node.js 20+
- PostgreSQL
- Redis (optional — the app works without it)

### Setup

```bash
# Clone the repository
git clone <repo-url>
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
| `SENDGRID_API_KEY` | SendGrid API key for email (optional) |
| `REDIS_URL` | Redis connection URL (optional) |
| `FRONTEND_URL` | Frontend URL for CORS and redirects |

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
| 1 – 10   | $99   |
| 11 – 50  | $299  |
| 51+      | $599  |

## Obtaining Guesty Open API Credentials

1. Log in to your [Guesty Dashboard](https://app.guesty.com)
2. Navigate to **Marketplace** → **Development Tools** → **Open API**
3. Create an API client with the required scopes
4. Note your **Client ID** and **Client Secret**
5. Repeat for both source and destination accounts

API documentation: [Guesty Open API Docs](https://open-api.guesty.com/api)

## License

MIT
