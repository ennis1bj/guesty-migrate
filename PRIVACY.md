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
- All credentials (Client IDs, Client Secrets, and cached OAuth access tokens) are encrypted at rest using AES-256-GCM authenticated encryption
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
- API credentials (Client Secrets) are encrypted using AES-256-GCM authenticated encryption before storage.
- Passwords are hashed using bcrypt with a cost factor of 12.
- JWT tokens are used for session management with a 7-day expiration.
- The application uses HTTPS in production and CORS restrictions.

## 5. Data Retention

- **Account data**: Retained as long as your account is active.
- **Migration logs and results**: Retained for 90 days after migration completion for support purposes.
- **Cached OAuth tokens**: Automatically expire and are overwritten on renewal.
- **API credentials**: Automatically purged (set to NULL) 30 days after a migration completes, fails, or completes with errors. Credentials are retained in encrypted form only while needed for active or recent migrations.

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

## 7. Data Subject Requests (DSR)

### Self-Serve Endpoints

You can exercise your data rights directly through the application at any time:

- **Export your data**: `GET /api/auth/export` — returns all account data, migration records, and logs in JSON format. Requires authentication.
- **Delete your account**: `DELETE /api/auth/account` — permanently deletes your account and all associated data (migrations, encrypted credentials, logs, and invoices). This action is irreversible. Requires authentication.

### Manual DSR Process

If you prefer to submit a data subject request manually, or if you are unable to use the self-serve endpoints:

1. **Email us** at privacy@guestymigrate.com with the subject line "Data Subject Request" and include:
   - Your registered email address
   - The type of request (access, correction, deletion, portability, or objection)
   - Any details to help us locate and process your request

2. **Acknowledgment**: We will acknowledge receipt of your request within **72 hours**.

3. **Fulfillment**: We will process and fulfill your request within **30 days** of receipt. If we need additional time (up to an additional 60 days for complex requests), we will notify you of the extension and the reasons for the delay.

### Identity Verification

To protect your privacy, we verify your identity before processing any manual DSR request. Verification may include confirming the email address associated with your account or requesting additional information to match our records. We will never ask for your Guesty API credentials as part of the verification process.

## 8. Third-Party Services

We use the following third-party services:

- **Stripe**: Payment processing ([Stripe Privacy Policy](https://stripe.com/privacy))
- **Resend**: Transactional email delivery ([Resend Privacy Policy](https://resend.com/legal/privacy-policy))
- **Guesty Open API**: Data migration source and destination (subject to your Guesty account terms)

## 9. Cookies and Local Storage

- We use a secure, httpOnly cookie to store the authentication token (JWT) for session persistence. This cookie is marked `HttpOnly`, `Secure` (in production), and `SameSite=Strict` to mitigate XSS and CSRF attacks.
- We do not use third-party tracking cookies or analytics.

## 10. Lawful Basis for Processing (GDPR)

We process your personal data under the following lawful bases as defined by GDPR Article 6:

- **Contract performance**: Processing your account information and API credentials is necessary to provide the migration service you requested.
- **Legitimate interests**: We process migration logs and technical data for service improvement, fraud prevention, and support purposes.
- **Consent**: Where required, we obtain your explicit consent for data processing (e.g., at registration).

## 11. Data Breach Notification

In the event of a personal data breach that is likely to result in a risk to your rights and freedoms, we will notify the relevant supervisory authority within 72 hours of becoming aware of the breach, as required by GDPR Article 33. If the breach is likely to result in a high risk to you, we will also notify you directly without undue delay.

## 12. International Data Transfers

If you are located outside the United States, please be aware that your data may be transferred to and processed in the United States. Where personal data is transferred from the EEA/UK to the US, we rely on Standard Contractual Clauses (SCCs) approved by the European Commission (Module 2: Controller-to-Processor) as the legal mechanism for such transfers. A Transfer Impact Assessment (TIA) has been conducted to evaluate the adequacy of protections. A copy of the applicable SCCs is available upon request by emailing privacy@guestymigrate.com.

## 13. California Residents (CCPA / CPRA)

If you are a California resident, you have the right to:

- **Know** what personal information we collect about you and how it is used.
- **Delete** your personal information (see Self-Serve Data Rights above).
- **Correct** inaccurate personal information we hold about you.
- **Limit use of sensitive personal information** — we only use sensitive PI (account credentials) as strictly necessary for service delivery.
- **Non-discrimination** for exercising your privacy rights.

We do not sell or share personal information for cross-context behavioral advertising. To exercise your rights, contact us at privacy@guestymigrate.com or use the self-serve endpoints described above.

## 14. Children's Privacy

The Service is not intended for use by individuals under the age of 18.

## 15. Changes to This Policy

We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated revision date.

## 16. Data Controller

The data controller for the purposes of GDPR Article 13 is:

ControlPlane Labs LLC
East Grand Rapids, MI 49506, USA
Email: privacy@guestymigrate.com

## 17. Contact

For privacy-related inquiries:
- Email: privacy@guestymigrate.com
