# Privacy Policy

_Last updated: March 2026_

## 1. Introduction

GuestyMigrate ("Service," "we," "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, store, and protect your information when you use our data migration service.

GuestyMigrate is not affiliated with Guesty Inc.

## 2. Information We Collect

### Account Information
- Email address (for authentication and communication)
- Hashed password (bcrypt, never stored in plaintext)

### API Credentials
- Guesty Open API Client IDs and Client Secrets for source and destination accounts
- All credentials (Client IDs, Client Secrets, and cached OAuth access tokens) are encrypted at rest using AES-256-CBC encryption
- OAuth access tokens are cached temporarily for API communication and encrypted while cached

### Migration Data
- Migration status, configuration, and logs
- Source account data manifests (category counts)
- Migration results and verification diff reports

### Payment Information
- Payment processing is handled entirely by Stripe. We do not store credit card numbers, CVVs, or full card details.
- We store Stripe session IDs for payment reconciliation.

## 3. How We Use Your Information

- **Authentication**: To create and manage your account
- **Migration Processing**: To read data from your source Guesty account and write it to your destination account
- **Communication**: To send migration completion reports via email
- **Support**: To help troubleshoot failed or incomplete migrations

## 4. Data Storage and Security

- All data is stored in PostgreSQL with connection pooling and access controls.
- API credentials (Client Secrets) are encrypted using AES-256-CBC before storage.
- Passwords are hashed using bcrypt with a cost factor of 10.
- JWT tokens are used for session management with a 7-day expiration.
- The application uses HTTPS in production and CORS restrictions.

## 5. Data Retention

- **Account data**: Retained as long as your account is active.
- **Migration logs and results**: Retained for 90 days after migration completion for support purposes.
- **Cached OAuth tokens**: Automatically expire and are overwritten on renewal.
- **API credentials**: Retained in encrypted form as long as the migration record exists.

## 6. Your Rights

You have the right to:

- **Access**: Request a copy of the personal data we hold about you.
- **Correction**: Request correction of inaccurate personal data.
- **Deletion**: Request deletion of your account and associated data.
- **Portability**: Request your data in a machine-readable format.
- **Objection**: Object to processing of your personal data.

### Self-Serve Data Rights

You can exercise your access and deletion rights directly through the application:

- **Data Export**: `GET /api/auth/export` — download all your account data in JSON format (requires authentication).
- **Account Deletion**: `DELETE /api/auth/account` — permanently delete your account and all associated data, including migrations, credentials, and logs (requires authentication).

For any other requests, contact us at privacy@guestymigrate.com.

## 7. Third-Party Services

We use the following third-party services:

- **Stripe**: Payment processing ([Stripe Privacy Policy](https://stripe.com/privacy))
- **Resend**: Transactional email delivery ([Resend Privacy Policy](https://resend.com/legal/privacy-policy))
- **Guesty Open API**: Data migration source and destination (subject to your Guesty account terms)

## 8. Cookies and Local Storage

- We use browser `localStorage` to store authentication tokens (JWT) for session persistence.
- We do not use third-party tracking cookies or analytics.

## 9. International Data Transfers

If you are located outside the United States, please be aware that your data may be transferred to and processed in the United States.

## 10. Children's Privacy

The Service is not intended for use by individuals under the age of 18.

## 11. Changes to This Policy

We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated revision date.

## 12. Contact

For privacy-related inquiries:
- Email: privacy@guestymigrate.com
