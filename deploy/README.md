# GCP Deployment Guide — GuestyMigrate

This guide walks through deploying the full GuestyMigrate stack to Google Cloud Platform using:

- **Cloud Run** — containerised services (main app + rate strategy migrator)
- **Cloud SQL** — managed PostgreSQL 15 (Auth Proxy via Unix socket)
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

# Allow Cloud Run to connect to Cloud SQL via Auth Proxy
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
  --no-assign-ip
```

> `--no-assign-ip` keeps the instance private. Cloud Run connects via the Cloud SQL Auth Proxy Unix socket injected by the `run.googleapis.com/cloudsql-instances` annotation in the Cloud Run YAML — no public IP or SSL config needed.

Create the database and user:

```bash
gcloud sql databases create guesty_migrate \
  --instance=guesty-migrate-db

# Set a strong password — save it for the DATABASE_URL secret below
gcloud sql users create guesty_app \
  --instance=guesty-migrate-db \
  --password=CHOOSE_A_STRONG_PASSWORD
```

Get the instance connection name (used in DATABASE_URL and the Cloud Run YAML):

```bash
gcloud sql instances describe guesty-migrate-db \
  --format="value(connectionName)"
# Output: PROJECT_ID:REGION:guesty-migrate-db
```

The `DATABASE_URL` secret value (Unix socket via Auth Proxy):

```
postgresql://guesty_app:PASSWORD@/guesty_migrate?host=/cloudsql/PROJECT_ID:REGION:guesty-migrate-db
```

> **How it works:** The `run.googleapis.com/cloudsql-instances: PROJECT_ID:REGION:guesty-migrate-db` annotation in both Cloud Run YAML files tells Cloud Run to inject the Cloud SQL Auth Proxy as a sidecar. The proxy creates a Unix socket at `/cloudsql/PROJECT_ID:REGION:guesty-migrate-db` that the app connects to via the URL above. No TLS or public IP is needed — the proxy handles secure communication internally.

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

The connector's full resource name (used in the Cloud Run YAML annotations):

```
projects/PROJECT_ID/locations/REGION/connectors/guesty-migrate-connector
```

---

## Step 7 — Create Secret Manager secrets

> **CRITICAL — `ENCRYPTION_KEY`:** If you are migrating from an existing Replit production deployment, you **must** use the same `ENCRYPTION_KEY` value. All Guesty credentials stored in the database are encrypted with this key. Using a different key will make all stored credentials permanently unreadable.

> **IMPORTANT — All referenced secrets must exist:** Cloud Run will refuse to start a revision if any secret referenced in the YAML is missing from Secret Manager. For optional features you are not using (e.g. Stripe, Resend, OperatorDeck), create the secret with a placeholder value rather than removing it from the YAML.

**Required secrets:**

```bash
echo -n "postgresql://guesty_app:PASSWORD@/guesty_migrate?host=/cloudsql/PROJECT_ID:REGION:guesty-migrate-db" \
  | gcloud secrets create DATABASE_URL --data-file=-

echo -n "redis://10.0.0.3:6379" \
  | gcloud secrets create REDIS_URL --data-file=-

echo -n "your-64-hex-char-jwt-secret" \
  | gcloud secrets create JWT_SECRET --data-file=-

# CRITICAL: use the SAME key as your existing production deployment
echo -n "your-32-byte-hex-encryption-key" \
  | gcloud secrets create ENCRYPTION_KEY --data-file=-

# Rate strategy migrator encryption key (may differ from main app key)
echo -n "your-32-byte-hex-payload-encryption-key" \
  | gcloud secrets create PAYLOAD_ENCRYPTION_KEY --data-file=-
```

**Optional secrets (create with real values or "disabled" placeholder):**

```bash
# Stripe — payments disabled if set to "disabled"
echo -n "sk_live_..." | gcloud secrets create STRIPE_SECRET_KEY --data-file=-
echo -n "pk_live_..." | gcloud secrets create STRIPE_PUBLISHABLE_KEY --data-file=-
echo -n "whsec_..."  | gcloud secrets create STRIPE_WEBHOOK_SECRET --data-file=-

# Email via Resend — emails disabled if set to "disabled"
echo -n "re_..."     | gcloud secrets create RESEND_API_KEY --data-file=-
echo -n "noreply@yourdomain.com" | gcloud secrets create FROM_EMAIL --data-file=-

# Admin account
echo -n "admin@yourdomain.com"   | gcloud secrets create ADMIN_EMAIL --data-file=-
echo -n "your-admin-password"    | gcloud secrets create ADMIN_PASSWORD --data-file=-

# OperatorDeck monitoring — disabled if set to "disabled"
echo -n "https://your-operatordeck-host" | gcloud secrets create OPERATORDECK_HOST --data-file=-
echo -n "your-operatordeck-token"        | gcloud secrets create OPERATORDECK_TOKEN --data-file=-
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
4. Choose your repository.
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

Before deploying, open both `deploy/main-app.cloudrun.yaml` and `deploy/rate-strategy-migrator.cloudrun.yaml` and replace all placeholder values:

| Placeholder | Replace with |
|---|---|
| `PROJECT_ID` | Your GCP project ID |
| `REGION` | Your GCP region (e.g. `us-central1`) |
| `REPO` | `guesty-migrate` |
| `IMAGE_TAG` | `latest` for first deploy |
| `CONNECTOR_NAME` | `guesty-migrate-connector` |

In `deploy/main-app.cloudrun.yaml`, update `FRONTEND_URL` to include your Cloud Run URL and custom domain (comma-separated). You will get the Cloud Run URL after the first deploy in Step 10; you may need to deploy once, then update the secret and redeploy.

---

## Step 10 — Deploy to Cloud Run

```bash
# Deploy main app
gcloud run services replace deploy/main-app.cloudrun.yaml \
  --region $REGION

# Get the assigned Cloud Run URL
MAIN_URL=$(gcloud run services describe guesty-migrate \
  --region $REGION --format="value(status.url)")
echo "Main app URL: $MAIN_URL"

# Update FRONTEND_URL in the YAML to use the real URL, then redeploy
# (or set it as an env var override via gcloud run services update)

# Deploy rate strategy migrator
gcloud run services replace deploy/rate-strategy-migrator.cloudrun.yaml \
  --region $REGION
```

Make both services publicly accessible:

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

**Subsequent deploys** are triggered automatically by pushing to `main` (Cloud Build builds → pushes → you trigger `services replace`). To update the running image without editing the YAML:

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
# Health check — main app (also verifies DB connectivity)
curl ${MAIN_URL}/api/health

# Health check — rate strategy migrator
MIGRATOR_URL=$(gcloud run services describe guesty-rate-strategy-migrator \
  --region $REGION --format="value(status.url)")
curl ${MIGRATOR_URL}/health
```

Both should return `{"status":"ok",...}`. The main app health check queries the database, so a successful response confirms Cloud SQL Auth Proxy connectivity.

---

## Step 12 — Stripe webhook update

After deploying, update your Stripe webhook endpoint in the [Stripe Dashboard](https://dashboard.stripe.com/webhooks):

```
https://YOUR_CLOUD_RUN_URL/api/webhooks/stripe
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
