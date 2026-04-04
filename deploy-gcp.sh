#!/bin/bash
#
# GuestyMigrate — Full GCP Deployment Script
# Run this in GCP Cloud Shell (already authenticated)
#
# Prerequisites:
#   1. Source deploy-gcp.env first: source deploy-gcp.env
#   2. Then run: chmod +x deploy-gcp.sh && ./deploy-gcp.sh
#
# The .env file contains all secrets and is NOT committed to git.
#
set -euo pipefail

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION (non-secret infrastructure settings)
# ═══════════════════════════════════════════════════════════════════════════════
REGION="us-central1"
DB_INSTANCE="guesty-migrate-db"
DB_NAME="guestymigrate"
DB_USER="gmuser"
REDIS_INSTANCE="guesty-migrate-redis"
VPC_CONNECTOR="guesty-connector"
AR_REPO="guesty-migrate"
SERVICE_NAME="guesty-migrate"

# ── Validate required env vars ────────────────────────────────────────────────
REQUIRED_VARS=(
  GCP_PROJECT DB_PASSWORD ENCRYPTION_KEY JWT_SECRET
  STRIPE_SECRET_KEY STRIPE_PUBLISHABLE_KEY STRIPE_WEBHOOK_SECRET
  RESEND_API_KEY ADMIN_EMAIL ADMIN_PASSWORD SESSION_SECRET
)
MISSING=()
for var in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    MISSING+=("$var")
  fi
done
if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "ERROR: Missing required environment variables:"
  printf '  - %s\n' "${MISSING[@]}"
  echo ""
  echo "Run: source deploy-gcp.env"
  exit 1
fi

IMAGE_TAG="us-central1-docker.pkg.dev/${GCP_PROJECT}/${AR_REPO}/app:latest"

# Stripe pricing (non-secret, can be in script)
STRIPE_PRICE_STARTER="${STRIPE_PRICE_STARTER:-price_1TCZbsArboRsa4oIJkygfbM3}"
STRIPE_PRICE_GROWTH="${STRIPE_PRICE_GROWTH:-price_1TCZbtArboRsa4oIRhr9GlUv}"
STRIPE_PRICE_PROFESSIONAL="${STRIPE_PRICE_PROFESSIONAL:-price_1TCZbtArboRsa4oITEonz2t6}"
STRIPE_PRICE_BUSINESS="${STRIPE_PRICE_BUSINESS:-price_1TCZbtArboRsa4oIZ4EjWzPt}"
STRIPE_PRICE_ENTERPRISE="${STRIPE_PRICE_ENTERPRISE:-price_1TCZbuArboRsa4oIKQWuCuCf}"
STRIPE_PRODUCT_PER_LISTING="${STRIPE_PRODUCT_PER_LISTING:-prod_UAvSpUZQxeKLda}"
STRIPE_PRICE_ADDON_PRIORITY="${STRIPE_PRICE_ADDON_PRIORITY:-price_1TCZbuArboRsa4oIsjrZLwmW}"
STRIPE_PRICE_ADDON_SUPPORT="${STRIPE_PRICE_ADDON_SUPPORT:-price_1TCZbvArboRsa4oISMlWy8ud}"
STRIPE_PRICE_ADDON_REMIGRATE="${STRIPE_PRICE_ADDON_REMIGRATE:-price_1TCZbvArboRsa4oIn5OmFhZq}"
STRIPE_PRICE_ADDON_VERIFY="${STRIPE_PRICE_ADDON_VERIFY:-price_1TCZbvArboRsa4oI5oz06vyB}"
LOG_LEVEL="${LOG_LEVEL:-info}"
OPERATORDECK_HOST="${OPERATORDECK_HOST:-https://operatordeck.ennis-studio.com}"

echo "════════════════════════════════════════════════════════════════"
echo "  GuestyMigrate GCP Deployment"
echo "  Project: ${GCP_PROJECT} | Region: ${REGION}"
echo "════════════════════════════════════════════════════════════════"

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 1: Set project & enable APIs
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "▸ Step 1: Setting project and enabling APIs..."
gcloud config set project "${GCP_PROJECT}"

gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  vpcaccess.googleapis.com \
  redis.googleapis.com \
  --project="${GCP_PROJECT}"

echo "  ✓ APIs enabled"

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 2: Artifact Registry
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "▸ Step 2: Creating Artifact Registry repository..."
gcloud artifacts repositories create "${AR_REPO}" \
  --repository-format=docker \
  --location="${REGION}" \
  --project="${GCP_PROJECT}" 2>/dev/null || echo "  (repository already exists)"
echo "  ✓ Artifact Registry ready"

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 3: Cloud SQL (PostgreSQL)
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "▸ Step 3: Creating Cloud SQL instance (this takes 5-10 min)..."
gcloud sql instances describe "${DB_INSTANCE}" --project="${GCP_PROJECT}" &>/dev/null && {
  echo "  (instance already exists, skipping creation)"
} || {
  gcloud sql instances create "${DB_INSTANCE}" \
    --database-version=POSTGRES_16 \
    --edition=enterprise \
    --tier=db-f1-micro \
    --region="${REGION}" \
    --storage-type=SSD \
    --storage-size=10GB \
    --no-storage-auto-increase \
    --project="${GCP_PROJECT}"
}

echo "  Creating database..."
gcloud sql databases create "${DB_NAME}" \
  --instance="${DB_INSTANCE}" \
  --project="${GCP_PROJECT}" 2>/dev/null || echo "  (database already exists)"

echo "  Creating/updating user..."
gcloud sql users create "${DB_USER}" \
  --instance="${DB_INSTANCE}" \
  --password="${DB_PASSWORD}" \
  --project="${GCP_PROJECT}" 2>/dev/null || {
  echo "  (user already exists, updating password)"
  gcloud sql users set-password "${DB_USER}" \
    --instance="${DB_INSTANCE}" \
    --password="${DB_PASSWORD}" \
    --project="${GCP_PROJECT}" 2>/dev/null || true
}

# Build connection name
CONN_NAME="${GCP_PROJECT}:${REGION}:${DB_INSTANCE}"
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost/${DB_NAME}?host=/cloudsql/${CONN_NAME}"
echo "  ✓ Cloud SQL ready — connection: ${CONN_NAME}"

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 4: Memorystore (Redis) + VPC Connector
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "▸ Step 4: Creating Memorystore Redis (takes 3-5 min)..."
gcloud redis instances describe "${REDIS_INSTANCE}" --region="${REGION}" --project="${GCP_PROJECT}" &>/dev/null && {
  echo "  (Redis instance already exists, skipping creation)"
} || {
  gcloud redis instances create "${REDIS_INSTANCE}" \
    --size=1 \
    --region="${REGION}" \
    --redis-version=redis_7_0 \
    --project="${GCP_PROJECT}"
}

REDIS_HOST=$(gcloud redis instances describe "${REDIS_INSTANCE}" \
  --region="${REGION}" --project="${GCP_PROJECT}" \
  --format="value(host)")
REDIS_URL="redis://${REDIS_HOST}:6379"
echo "  Redis host: ${REDIS_HOST}"

echo "  Creating VPC connector..."
gcloud compute networks vpc-access connectors describe "${VPC_CONNECTOR}" \
  --region="${REGION}" --project="${GCP_PROJECT}" &>/dev/null && {
  echo "  (VPC connector already exists)"
} || {
  gcloud compute networks vpc-access connectors create "${VPC_CONNECTOR}" \
    --region="${REGION}" \
    --range=10.8.0.0/28 \
    --project="${GCP_PROJECT}"
}
echo "  ✓ Memorystore + VPC connector ready"

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 5: Secret Manager
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "▸ Step 5: Storing secrets in Secret Manager..."

store_secret() {
  local name=$1
  local value=$2
  printf '%s' "$value" | gcloud secrets create "$name" --data-file=- --project="${GCP_PROJECT}" 2>/dev/null || {
    echo "  (secret ${name} exists, adding new version)"
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- --project="${GCP_PROJECT}"
  }
  echo "  ✓ ${name}"
}

store_secret "DATABASE_URL" "${DATABASE_URL}"
store_secret "JWT_SECRET" "${JWT_SECRET}"
store_secret "ENCRYPTION_KEY" "${ENCRYPTION_KEY}"
store_secret "STRIPE_SECRET_KEY" "${STRIPE_SECRET_KEY}"
store_secret "STRIPE_PUBLISHABLE_KEY" "${STRIPE_PUBLISHABLE_KEY}"
store_secret "STRIPE_WEBHOOK_SECRET" "${STRIPE_WEBHOOK_SECRET}"
store_secret "RESEND_API_KEY" "${RESEND_API_KEY}"
store_secret "REDIS_URL" "${REDIS_URL}"
store_secret "ADMIN_EMAIL" "${ADMIN_EMAIL}"
store_secret "ADMIN_PASSWORD" "${ADMIN_PASSWORD}"
store_secret "SESSION_SECRET" "${SESSION_SECRET}"
store_secret "OPERATORDECK_TOKEN" "${OPERATORDECK_TOKEN:-}"

# Grant Cloud Run SA access to all secrets
PROJECT_NUMBER=$(gcloud projects describe "${GCP_PROJECT}" --format="value(projectNumber)")
SA="service-${PROJECT_NUMBER}@serverless-robot-prod.iam.gserviceaccount.com"

for SECRET in DATABASE_URL JWT_SECRET ENCRYPTION_KEY STRIPE_SECRET_KEY \
  STRIPE_PUBLISHABLE_KEY STRIPE_WEBHOOK_SECRET RESEND_API_KEY REDIS_URL \
  ADMIN_EMAIL ADMIN_PASSWORD SESSION_SECRET OPERATORDECK_TOKEN; do
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --member="serviceAccount:${SA}" \
    --role="roles/secretmanager.secretAccessor" \
    --project="${GCP_PROJECT}" --quiet 2>/dev/null || true
done
echo "  ✓ All secrets stored and SA permissions granted"

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 6: Build & Push Container Image
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "▸ Step 6: Building and pushing container image..."

gcloud builds submit \
  --tag "${IMAGE_TAG}" \
  --project="${GCP_PROJECT}" \
  --timeout=1200

echo "  ✓ Image pushed to ${IMAGE_TAG}"

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 7: Deploy to Cloud Run
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "▸ Step 7: Deploying to Cloud Run..."

gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE_TAG}" \
  --platform managed \
  --region "${REGION}" \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 1 \
  --max-instances 5 \
  --add-cloudsql-instances "${CONN_NAME}" \
  --vpc-connector "${VPC_CONNECTOR}" \
  --vpc-egress all-traffic \
  --set-env-vars "NODE_ENV=production,LOG_LEVEL=${LOG_LEVEL},STRIPE_PRICE_STARTER=${STRIPE_PRICE_STARTER},STRIPE_PRICE_GROWTH=${STRIPE_PRICE_GROWTH},STRIPE_PRICE_PROFESSIONAL=${STRIPE_PRICE_PROFESSIONAL},STRIPE_PRICE_BUSINESS=${STRIPE_PRICE_BUSINESS},STRIPE_PRICE_ENTERPRISE=${STRIPE_PRICE_ENTERPRISE},STRIPE_PRODUCT_PER_LISTING=${STRIPE_PRODUCT_PER_LISTING},STRIPE_PRICE_ADDON_PRIORITY=${STRIPE_PRICE_ADDON_PRIORITY},STRIPE_PRICE_ADDON_SUPPORT=${STRIPE_PRICE_ADDON_SUPPORT},STRIPE_PRICE_ADDON_REMIGRATE=${STRIPE_PRICE_ADDON_REMIGRATE},STRIPE_PRICE_ADDON_VERIFY=${STRIPE_PRICE_ADDON_VERIFY},FROM_EMAIL=noreply@guestymigrate.com,DB_SSL=false,OPERATORDECK_HOST=${OPERATORDECK_HOST}" \
  --set-secrets "DATABASE_URL=DATABASE_URL:latest,JWT_SECRET=JWT_SECRET:latest,ENCRYPTION_KEY=ENCRYPTION_KEY:latest,STRIPE_SECRET_KEY=STRIPE_SECRET_KEY:latest,STRIPE_PUBLISHABLE_KEY=STRIPE_PUBLISHABLE_KEY:latest,STRIPE_WEBHOOK_SECRET=STRIPE_WEBHOOK_SECRET:latest,RESEND_API_KEY=RESEND_API_KEY:latest,REDIS_URL=REDIS_URL:latest,ADMIN_EMAIL=ADMIN_EMAIL:latest,ADMIN_PASSWORD=ADMIN_PASSWORD:latest,SESSION_SECRET=SESSION_SECRET:latest,OPERATORDECK_TOKEN=OPERATORDECK_TOKEN:latest" \
  --project="${GCP_PROJECT}"

# Get the service URL
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --region="${REGION}" --project="${GCP_PROJECT}" \
  --format="value(status.url)")

echo "  ✓ Deployed to: ${SERVICE_URL}"

# Set FRONTEND_URL
echo ""
echo "▸ Setting FRONTEND_URL..."
gcloud run services update "${SERVICE_NAME}" \
  --region "${REGION}" \
  --update-env-vars "FRONTEND_URL=${SERVICE_URL}" \
  --project="${GCP_PROJECT}"
echo "  ✓ FRONTEND_URL set to ${SERVICE_URL}"

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 8: Database Migration (via Cloud Run Job)
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "▸ Step 8: Running database migration..."

gcloud run jobs create guesty-migrate-db-init \
  --image "${IMAGE_TAG}" \
  --region "${REGION}" \
  --add-cloudsql-instances "${CONN_NAME}" \
  --vpc-connector "${VPC_CONNECTOR}" \
  --vpc-egress all-traffic \
  --set-env-vars "NODE_ENV=production,DB_SSL=false" \
  --set-secrets "DATABASE_URL=DATABASE_URL:latest,JWT_SECRET=JWT_SECRET:latest,ENCRYPTION_KEY=ENCRYPTION_KEY:latest,ADMIN_EMAIL=ADMIN_EMAIL:latest,ADMIN_PASSWORD=ADMIN_PASSWORD:latest" \
  --command="node" \
  --args="server/db.js,migrate" \
  --project="${GCP_PROJECT}" 2>/dev/null || echo "  (job already exists, will execute)"

gcloud run jobs execute guesty-migrate-db-init \
  --region "${REGION}" \
  --wait \
  --project="${GCP_PROJECT}"

echo "  ✓ Database migration complete"

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 9: Verification
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "▸ Step 9: Verifying deployment..."
sleep 10

echo "  Health check:"
curl -s "${SERVICE_URL}/api/health" | python3 -m json.tool 2>/dev/null || curl -s "${SERVICE_URL}/api/health"

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  DEPLOYMENT COMPLETE"
echo ""
echo "  Service URL:    ${SERVICE_URL}"
echo "  Health Check:   ${SERVICE_URL}/api/health"
echo "  Admin Email:    ${ADMIN_EMAIL}"
echo ""
echo "  NEXT STEPS:"
echo "  1. Stripe Webhook: Add endpoint ${SERVICE_URL}/api/webhooks/stripe"
echo "     Event: checkout.session.completed"
echo "     Then update STRIPE_WEBHOOK_SECRET in Secret Manager"
echo "  2. Custom domain: Map guestymigrate.com via Cloud Run domain mapping"
echo "  3. Update FRONTEND_URL if you add a custom domain"
echo "════════════════════════════════════════════════════════════════"
