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
- Your API credentials are encrypted at rest using AES-256-GCM authenticated encryption.
- You are responsible for ensuring you have authorization to access and migrate data from both accounts.

## 5. Payment and Refunds

- The Service uses one-time payments processed through Stripe.
- Pricing is based on the number of listings in the source account at the time of migration.
- Payments are non-refundable once a migration has begun processing.
- If a migration fails due to a Service error (not an API credential or rate limit issue), you may retry the migration at no additional cost. Contact support at support@guestymigrate.com if the retry does not resolve the issue.

## 6. Data Handling

- The Service reads data from your source Guesty account and writes it to your destination Guesty account.
- The Service does not store your Guesty property data permanently. Migration results and logs are retained for support purposes.
- API credentials are encrypted at rest and are only decrypted during active migration processing.

## 7. Limitations

- The Service migrates data categories as described in the documentation: listings (including complex/MTL parent-child hierarchies), guests, owners, reservations (direct/manual only), automations, tasks, custom fields, rate strategies, fees, taxes, saved replies, photos, and calendar blocks.
- Channel-managed reservations (Airbnb, Vrbo, Booking.com, etc.) are not migrated and must be re-synced by reconnecting channels.
- Task assignees are not remapped between accounts.
- The Service does not guarantee 100% data fidelity due to Guesty API limitations.

## 8. Disclaimer of Warranties

THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.

## 9. Limitation of Liability

IN NO EVENT SHALL GUESTYMIGRATE BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF DATA, REVENUE, OR PROFITS, WHETHER DIRECT OR INDIRECT, ARISING OUT OF YOUR USE OF THE SERVICE.

## 10. Account Termination

We reserve the right to suspend or terminate your account at any time if you violate these Terms, misuse the Service, or engage in fraudulent activity. Upon termination, your right to use the Service ceases immediately. You may delete your account at any time via the self-serve account deletion endpoint.

## 11. Indemnification

You agree to indemnify, defend, and hold harmless GuestyMigrate, its affiliates, and their respective officers, directors, and employees from any claims, damages, losses, or expenses (including reasonable attorneys' fees) arising out of your use of the Service, including but not limited to unauthorized data migration or violation of any third-party rights.

## 12. Governing Law

These Terms are governed by and construed in accordance with the laws of the State of Michigan, United States, without regard to its conflict of law provisions. Any disputes arising under these Terms shall be resolved in the state or federal courts located in Kent County, Michigan.

## 13. Changes to Terms

We reserve the right to modify these Terms at any time. We will notify registered users of material changes by email at least 14 days before they take effect. Continued use of the Service after the effective date of changes constitutes acceptance of the updated Terms. If you do not agree to the updated Terms, you may delete your account before the effective date.

## 14. EU Consumer Right of Withdrawal

If you are a consumer in the European Economic Area, you have a 14-day right of withdrawal from the date of purchase. By initiating a migration, you expressly consent to the immediate performance of the Service before the withdrawal period expires and acknowledge that you lose your right of withdrawal once the migration has begun processing.

## 15. Contact

For questions about these Terms, contact us at support@guestymigrate.com.
