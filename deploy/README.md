# GCP Deployment Guide — GuestyMigrate

This guide walks through deploying the full GuestyMigrate stack to Google Cloud Platform using:

- **Cloud Run** — containerised services (main app + rate strategy migrator)
- **Cloud SQL** — managed PostgreSQL 15
- **Memorystore** — managed Redis 7
- **Artifact Registry** — Docker image storage
- **Secret Manager** — environment variable secrets
- **Serverless VPC Access** — private connectivity between Cloud Run and Memorystore
- **Cloud Build** — CI/CD triggered from GitHub

---

## Prerequisites

- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) installed and authenticated (`gcloud auth login`)
- A GCP project created (`gcloud projects create YOUR_PROJECT_ID`)
- Billing enabled on the project
- Docker installed locally (for manual image pushes if needed)

Set your project once for the session:

```bash
export PROJECT_ID=your-project-id
export REGION=us-central1
gcloud config set project $PROJECT_ID
gcloud config set run/region $REGION
```

---

## Step 1 — Enable required GCP APIs

```bash
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  redis.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  vpcaccess.googleapis.com \
  servicenetworking.googleapis.com
```

---

## Step 2 — Create Artifact Registry repository

```bash
gcloud artifacts repositories create guesty-migrate \
  --repository-format=docker \
  --location=$REGION \
  --description="GuestyMigrate Docker images"
```

Authenticate Docker to push to Artifact Registry:

```bash
gcloud auth configure-docker ${REGION}-docker.pkg.dev
```

---

## Step 3 — Create a service account for Cloud Run

```bash
gcloud iam service-accounts create guesty-migrate-sa \
  --display-name="GuestyMigrate Cloud Run SA"

SA=guesty-migrate-sa@${PROJECT_ID}.iam.gserviceaccount.com

# Allow Cloud Run to read secrets
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA}" \
  --role="roles/secretmanager.secretAccessor"

# Allow Cloud Run to connect to Cloud SQL
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA}" \
  --role="roles/cloudsql.client"
```

---

## Step 4 — Create Cloud SQL (PostgreSQL 15)

```bash
gcloud sql instances create guesty-migrate-db \
  --database-version=POSTGRES_15 \
  --tier=db-g1-small \
  --region=$REGION \
  --storage-auto-increase \
  --backup-start-time=03:00 \
  --require-ssl
```

Create the database and user:

```bash
gcloud sql databases create guesty_migrate \
  --instance=guesty-migrate-db

# Set a strong password — save it for the DATABASE_URL secret below
gcloud sql users create guesty_app \
  --instance=guesty-migrate-db \
  --password=CHOOSE_A_STRONG_PASSWORD
```

Get the instance connection string (used in DATABASE_URL):

```bash
gcloud sql instances describe guesty-migrate-db \
  --format="value(connectionName)"
# Output format: PROJECT_ID:REGION:guesty-migrate-db
```

The `DATABASE_URL` for Cloud SQL via TCP with SSL:

```
postgresql://guesty_app:PASSWORD@/guesty_migrate?host=/cloudsql/PROJECT_ID:REGION:guesty-migrate-db&sslmode=require
```

> **Tip:** Cloud Run can connect to Cloud SQL via the Cloud SQL Auth Proxy sidecar (recommended) or via a public IP with SSL. The simplest approach for Cloud Run is to use the Unix socket path shown above — the Cloud SQL Auth Proxy is automatically injected when `DB_SSL=true` and the `cloudsql.googleapis.com` annotation is present. Alternatively, use a direct TCP connection string and set `DB_SSL=true`.

---

## Step 5 — Create Memorystore (Redis 7)

Memorystore is a **private-IP-only** service. Cloud Run cannot reach it without a VPC Connector (Step 6).

```bash
gcloud redis instances create guesty-migrate-redis \
  --size=1 \
  --region=$REGION \
  --redis-version=redis_7_0 \
  --tier=basic
```

Get the Redis private IP (used in REDIS_URL):

```bash
gcloud redis instances describe guesty-migrate-redis \
  --region=$REGION \
  --format="value(host,port)"
# Example output: 10.0.0.3  6379
```

The `REDIS_URL` secret value:

```
redis://10.0.0.3:6379
```

---

## Step 6 — Create Serverless VPC Access Connector

This is required for Cloud Run → Memorystore (private IP) connectivity.

```bash
gcloud compute networks create guesty-migrate-vpc \
  --subnet-mode=auto

gcloud vpc-access connectors create guesty-migrate-connector \
  --region=$REGION \
  --network=guesty-migrate-vpc \
  --range=10.8.0.0/28

# Confirm it is READY before proceeding
gcloud vpc-access connectors describe guesty-migrate-connector \
  --region=$REGION \
  --format="value(state)"
```

Note the connector's full resource name for the Cloud Run YAML files:

```
projects/PROJECT_ID/locations/REGION/connectors/guesty-migrate-connector
```

Update both YAML files (`deploy/main-app.cloudrun.yaml` and `deploy/rate-strategy-migrator.cloudrun.yaml`) — replace the `CONNECTOR_NAME` placeholder with `guesty-migrate-connector` and `PROJECT_ID`/`REGION` with your values.

---

## Step 7 — Create Secret Manager secrets

> **CRITICAL — `ENCRYPTION_KEY`:** If you are migrating from an existing Replit production deployment, you **must** use the same `ENCRYPTION_KEY` value that was used there. All Guesty credentials stored in the database are encrypted with this key. Using a different key will make all stored credentials permanently unreadable.

Create each secret with the command below, substituting the actual value:

```bash
# Required
echo -n "postgresql://guesty_app:PASSWORD@/guesty_migrate?host=..." \
  | gcloud secrets create DATABASE_URL --data-file=-

echo -n "redis://10.0.0.3:6379" \
  | gcloud secrets create REDIS_URL --data-file=-

echo -n "your-64-hex-char-jwt-secret" \
  | gcloud secrets create JWT_SECRET --data-file=-

# CRITICAL: use the SAME key as your existing production deployment
echo -n "your-32-byte-hex-encryption-key" \
  | gcloud secrets create ENCRYPTION_KEY --data-file=-

# Rate strategy migrator encryption key (separate from main app key)
echo -n "your-32-byte-hex-payload-encryption-key" \
  | gcloud secrets create PAYLOAD_ENCRYPTION_KEY --data-file=-

# Optional — Stripe (payments disabled if absent)
echo -n "sk_live_..." \
  | gcloud secrets create STRIPE_SECRET_KEY --data-file=-

echo -n "pk_live_..." \
  | gcloud secrets create STRIPE_PUBLISHABLE_KEY --data-file=-

echo -n "whsec_..." \
  | gcloud secrets create STRIPE_WEBHOOK_SECRET --data-file=-

# Optional — Email (Resend)
echo -n "re_..." \
  | gcloud secrets create RESEND_API_KEY --data-file=-

echo -n "noreply@yourdomain.com" \
  | gcloud secrets create FROM_EMAIL --data-file=-

# Admin account
echo -n "admin@yourdomain.com" \
  | gcloud secrets create ADMIN_EMAIL --data-file=-

echo -n "your-admin-password" \
  | gcloud secrets create ADMIN_PASSWORD --data-file=-

# OperatorDeck monitoring (optional)
echo -n "https://your-operatordeck-host" \
  | gcloud secrets create OPERATORDECK_HOST --data-file=-

echo -n "your-operatordeck-token" \
  | gcloud secrets create OPERATORDECK_TOKEN --data-file=-
```

Grant the service account access to each secret:

```bash
for SECRET in DATABASE_URL REDIS_URL JWT_SECRET ENCRYPTION_KEY \
  PAYLOAD_ENCRYPTION_KEY STRIPE_SECRET_KEY STRIPE_PUBLISHABLE_KEY \
  STRIPE_WEBHOOK_SECRET RESEND_API_KEY FROM_EMAIL ADMIN_EMAIL \
  ADMIN_PASSWORD OPERATORDECK_HOST OPERATORDECK_TOKEN; do
  gcloud secrets add-iam-policy-binding $SECRET \
    --member="serviceAccount:${SA}" \
    --role="roles/secretmanager.secretAccessor" 2>/dev/null || true
done
```

---

## Step 8 — Connect Cloud Build to GitHub

1. Open the [Cloud Build triggers page](https://console.cloud.google.com/cloud-build/triggers) in the GCP Console.
2. Click **Connect repository**.
3. Select **GitHub (Cloud Build GitHub App)** and authenticate.
4. Choose your repository (`guesty-migrate` or similar).
5. Click **Create a trigger**:
   - **Event:** Push to a branch
   - **Branch:** `^main$` (or your default branch)
   - **Build configuration:** `cloudbuild.yaml`
   - **Substitution variables:**
     - `_REGION` = `us-central1` (or your region)
     - `_REPO` = `guesty-migrate`

From this point, every push to `main` automatically builds and pushes both Docker images.

---

## Step 9 — Update the Cloud Run YAML files

Before deploying, edit both YAML files and replace all placeholder values:

| Placeholder | Replace with |
|---|---|
| `PROJECT_ID` | Your GCP project ID |
| `REGION` | Your GCP region (e.g. `us-central1`) |
| `REPO` | `guesty-migrate` (or your Artifact Registry repo name) |
| `IMAGE_TAG` | `latest` for first deploy; use `$SHORT_SHA` in automation |
| `CONNECTOR_NAME` | `guesty-migrate-connector` |
| `YOUR_CLOUD_RUN_URL` | The Cloud Run URL (available after first deploy) |
| `YOUR_CUSTOM_DOMAIN` | Your custom domain, if any |

In `deploy/main-app.cloudrun.yaml`, update `FRONTEND_URL` to include both your Cloud Run URL and your custom domain (comma-separated):

```yaml
- name: FRONTEND_URL
  value: https://guesty-migrate-abc123-uc.a.run.app,https://app.yourdomain.com
```

---

## Step 10 — Deploy to Cloud Run

**First deploy** (before the Cloud Run URL is known — deploy with the placeholder URL, then update `FRONTEND_URL` after):

```bash
# Deploy main app
gcloud run services replace deploy/main-app.cloudrun.yaml \
  --region $REGION

# Get the Cloud Run URL
gcloud run services describe guesty-migrate \
  --region $REGION \
  --format="value(status.url)"

# Update FRONTEND_URL secret with the actual URL, then redeploy
echo -n "https://guesty-migrate-xyz-uc.a.run.app" \
  | gcloud secrets versions add FRONTEND_URL --data-file=- 2>/dev/null || \
  echo -n "https://guesty-migrate-xyz-uc.a.run.app" \
  | gcloud secrets create FRONTEND_URL --data-file=-

# Deploy rate strategy migrator
gcloud run services replace deploy/rate-strategy-migrator.cloudrun.yaml \
  --region $REGION
```

Make both services public (allow unauthenticated HTTP):

```bash
gcloud run services add-iam-policy-binding guesty-migrate \
  --region=$REGION \
  --member="allUsers" \
  --role="roles/run.invoker"

gcloud run services add-iam-policy-binding guesty-rate-strategy-migrator \
  --region=$REGION \
  --member="allUsers" \
  --role="roles/run.invoker"
```

**Subsequent deploys** (after CI/CD is set up) are triggered automatically by pushing to `main`. To deploy manually after Cloud Build pushes a new image:

```bash
gcloud run services update guesty-migrate \
  --image=${REGION}-docker.pkg.dev/${PROJECT_ID}/guesty-migrate/guesty-migrate:latest \
  --region=$REGION

gcloud run services update guesty-rate-strategy-migrator \
  --image=${REGION}-docker.pkg.dev/${PROJECT_ID}/guesty-migrate/guesty-rate-strategy-migrator:latest \
  --region=$REGION
```

---

## Step 11 — Verify the deployment

```bash
# Health check — main app
curl https://$(gcloud run services describe guesty-migrate \
  --region $REGION --format="value(status.url)")/api/health

# Health check — rate strategy migrator
curl https://$(gcloud run services describe guesty-rate-strategy-migrator \
  --region $REGION --format="value(status.url)")/health
```

Both should return `{"status":"ok",...}`.

---

## Step 12 — Stripe webhook update

After deploying, update your Stripe webhook endpoint in the [Stripe Dashboard](https://dashboard.stripe.com/webhooks) to point to the new Cloud Run URL:

```
https://guesty-migrate-xyz-uc.a.run.app/api/webhooks/stripe
```

---

## Estimated GCP costs (us-central1, light traffic)

| Service | SKU | Estimated monthly cost |
|---|---|---|
| Cloud Run — main app | 1 min instance + traffic | ~$10–25 |
| Cloud Run — migrator | 1 min instance (2 GB) | ~$30–50 |
| Cloud SQL — db-g1-small | Always on | ~$25 |
| Memorystore — 1 GB Basic | Always on | ~$35 |
| Artifact Registry | ~5 GB storage | ~$0.50 |
| Secret Manager | API calls | ~$0 |
| Cloud Build | 120 free min/day | ~$0 |

> Costs vary. Use the [GCP Pricing Calculator](https://cloud.google.com/products/calculator) for accurate estimates.

---

## Next steps (out of scope for this guide)

- **Custom domain** — map a domain to Cloud Run via `gcloud run domain-mappings create`
- **Cloud Armor** — add WAF / DDoS protection in front of the load balancer
- **Cloud CDN** — cache static assets for lower latency and egress costs
- **Uptime monitoring** — add Cloud Monitoring uptime checks on `/api/health` and `/health`
- **Alerts** — set up alerting policies for 5xx error rates and Cloud SQL disk usage
