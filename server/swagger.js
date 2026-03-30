/**
 * OpenAPI / Swagger documentation for GuestyMigrate API.
 *
 * Mounts at GET /api/docs in development mode.
 * Exports a static spec at GET /api/docs/spec.json.
 */

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'GuestyMigrate API',
    version: '1.0.0',
    description: 'Self-serve migration tool for transferring data between Guesty property management accounts.',
    contact: { email: 'support@guestymigrate.com' },
  },
  servers: [
    { url: '/api', description: 'API base path' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          is_demo: { type: 'boolean' },
          email_verified: { type: 'boolean' },
        },
      },
      Manifest: {
        type: 'object',
        properties: {
          custom_fields: { type: 'integer' },
          fees: { type: 'integer' },
          listings: { type: 'integer' },
          reservations: { type: 'integer' },
          guests: { type: 'integer' },
          owners: { type: 'integer' },
          saved_replies: { type: 'integer' },
          tasks: { type: 'integer' },
          photos: { type: 'integer' },
        },
      },
    },
  },
  paths: {
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new user account',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 6 },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'User created, JWT returned' },
          409: { description: 'Email already registered' },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Log in and receive a JWT',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'JWT token returned' },
          401: { description: 'Invalid credentials' },
        },
      },
    },
    '/auth/forgot-password': {
      post: {
        tags: ['Auth'],
        summary: 'Request a password reset email',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: { email: { type: 'string', format: 'email' } },
              },
            },
          },
        },
        responses: { 200: { description: 'Reset email sent (if account exists)' } },
      },
    },
    '/auth/reset-password': {
      post: {
        tags: ['Auth'],
        summary: 'Reset password with token from email',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['token', 'password'],
                properties: {
                  token: { type: 'string' },
                  password: { type: 'string', minLength: 6 },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Password reset successfully' },
          400: { description: 'Invalid or expired token' },
        },
      },
    },
    '/auth/verify/{token}': {
      get: {
        tags: ['Auth'],
        summary: 'Verify email address',
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Email verified' },
          400: { description: 'Invalid or expired token' },
        },
      },
    },
    '/auth/export': {
      get: {
        tags: ['GDPR'],
        summary: 'Export all user data (GDPR data access)',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'JSON export of all user data' } },
      },
    },
    '/auth/account': {
      delete: {
        tags: ['GDPR'],
        summary: 'Delete account and all data (GDPR right to erasure)',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Account deleted' } },
      },
    },
    '/migrations/preflight': {
      post: {
        tags: ['Migrations'],
        summary: 'Validate credentials and generate manifest + pricing',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['sourceClientId', 'sourceClientSecret', 'destClientId', 'destClientSecret'],
                properties: {
                  sourceClientId: { type: 'string' },
                  sourceClientSecret: { type: 'string' },
                  destClientId: { type: 'string' },
                  destClientSecret: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Manifest, pricing, and migrationId' },
          400: { description: 'Invalid credentials' },
        },
      },
    },
    '/migrations/{id}/checkout': {
      post: {
        tags: ['Migrations'],
        summary: 'Create a Stripe Checkout session',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Stripe checkout URL' },
          404: { description: 'Migration not found' },
        },
      },
    },
    '/migrations/{id}/status': {
      get: {
        tags: ['Migrations'],
        summary: 'Get migration status, results, and logs',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Migration status with logs' },
          404: { description: 'Migration not found' },
        },
      },
    },
    '/migrations/{id}/report': {
      get: {
        tags: ['Migrations'],
        summary: 'Get the verification diff report',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Diff report JSON' } },
      },
    },
    '/migrations/{id}/retry': {
      post: {
        tags: ['Migrations'],
        summary: 'Retry a failed migration (re-runs incomplete categories)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Retry enqueued' } },
      },
    },
    '/migrations': {
      get: {
        tags: ['Migrations'],
        summary: 'List all migrations for the authenticated user',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Array of migrations' } },
      },
    },
    '/pricing': {
      get: {
        tags: ['Pricing'],
        summary: 'Get current pricing tiers and add-ons (public)',
        responses: { 200: { description: 'Pricing tiers and add-on definitions' } },
      },
    },
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        responses: { 200: { description: 'OK' } },
      },
    },
  },
};

/**
 * Mount Swagger UI on an Express app (development only).
 */
function mountSwagger(app) {
  // Serve the raw spec
  app.get('/api/docs/spec.json', (req, res) => res.json(spec));

  // Serve a minimal Swagger UI via CDN (no npm dep needed)
  app.get('/api/docs', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>GuestyMigrate API Docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: '/api/docs/spec.json', dom_id: '#swagger-ui' });
  </script>
</body>
</html>`);
  });
}

module.exports = { spec, mountSwagger };
