# Use the official Playwright Docker base image.
# It includes Chromium and all required system dependencies pre-installed,
# and runs as the non-root 'pwuser' so the Chrome sandbox works without --no-sandbox.
FROM mcr.microsoft.com/playwright:v1.44.0-noble

WORKDIR /app

# Install dependencies first (layer caching)
COPY package*.json ./
RUN npm ci

# Copy source and compile TypeScript
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV HEADLESS=true

# Switch to the non-root user built into the Playwright base image.
# This ensures Chrome's sandbox runs correctly without --no-sandbox.
USER pwuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
