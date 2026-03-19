# GuestyMigrate

A self-serve, automated migration tool for transferring data between Guesty property management accounts using the Guesty Open API.

## Architecture

- **Frontend**: React 18 + TypeScript + Tailwind CSS, served by Vite on port 5000
- **Backend**: Express.js API server on port 3001
- **Database**: PostgreSQL (Replit built-in)
- **Job Queue**: BullMQ + Redis (optional; falls back to in-process if REDIS_URL not set)

## Project Structure

```
client/          React frontend (Vite)
server/          Express backend
  auth.js        JWT authentication
  db.js          PostgreSQL schema & migrations
  encryption.js  AES-256-CBC for API credentials
  email.js       SendGrid email
  guestyClient.js  Guesty API wrapper
  migrationEngine.js  Core migration logic
  queue.js       BullMQ job queue
  routes/        API route handlers
```

## Development

- `npm run dev` — starts both the backend (nodemon) and frontend (Vite) concurrently
- Frontend: http://0.0.0.0:5000 (proxies /api to backend at localhost:3001)
- Backend: http://localhost:3001

## Environment Variables

Required:
- `DATABASE_URL` — PostgreSQL connection string (auto-set by Replit)
- `JWT_SECRET` — Secret for JWT signing
- `ENCRYPTION_KEY` — 32-byte hex key for AES-256-CBC

Optional (Stripe payments):
- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`

Optional (Email):
- `SENDGRID_API_KEY`
- `FROM_EMAIL`

Optional (Redis/BullMQ):
- `REDIS_URL` — Falls back to in-process job execution if not set

## Deployment

Production: Express serves the built React frontend as static files.
- Build: `npm run build` (builds client to client/dist)
- Run: `node server/index.js`
