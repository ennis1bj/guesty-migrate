# Terms of Service

_Last updated: March 2026_

## 1. Acceptance of Terms

By accessing or using GuestyMigrate ("Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the Service.

## 2. Description of Service

GuestyMigrate is a self-serve data migration tool that transfers data between Guesty.com property management accounts using the Guesty Open API. The Service is not affiliated with, endorsed by, or sponsored by Guesty Inc.

## 3. User Accounts

- You must provide a valid email address and create a password to use the Service.
- You are responsible for maintaining the confidentiality of your account credentials.
- You are responsible for all activities that occur under your account.

## 4. API Credentials

- You provide Guesty Open API credentials (Client ID and Client Secret) for both source and destination accounts.
- Your API credentials are encrypted at rest using AES-256-CBC encryption.
- You are responsible for ensuring you have authorization to access and migrate data from both accounts.

## 5. Payment and Refunds

- The Service uses one-time payments processed through Stripe.
- Pricing is based on the number of listings in the source account at the time of migration.
- Payments are non-refundable once a migration has begun processing.
- If a migration fails due to a Service error (not an API credential or rate limit issue), contact support to discuss resolution.

## 6. Data Handling

- The Service reads data from your source Guesty account and writes it to your destination Guesty account.
- The Service does not store your Guesty property data permanently. Migration results and logs are retained for support purposes.
- API credentials are encrypted at rest and are only decrypted during active migration processing.

## 7. Limitations

- The Service migrates data categories as described in the documentation: listings, guests, owners, reservations (direct/manual only), automations, tasks, custom fields, fees, taxes, photos, and calendar blocks.
- Channel-managed reservations (Airbnb, Vrbo, Booking.com, etc.) are not migrated and must be re-synced by reconnecting channels.
- Task assignees are not remapped between accounts.
- The Service does not guarantee 100% data fidelity due to Guesty API limitations.

## 8. Disclaimer of Warranties

THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.

## 9. Limitation of Liability

IN NO EVENT SHALL GUESTYMIGRATE BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF DATA, REVENUE, OR PROFITS, WHETHER DIRECT OR INDIRECT, ARISING OUT OF YOUR USE OF THE SERVICE.

## 10. Changes to Terms

We reserve the right to modify these Terms at any time. Continued use of the Service after changes constitutes acceptance of the updated Terms.

## 11. Contact

For questions about these Terms, contact us at support@guestymigrate.com.
