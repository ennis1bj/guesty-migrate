export default function Privacy() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Privacy Policy</h1>
      <p className="text-sm text-gray-500 mb-8">Last updated: March 2026</p>

      <div className="prose prose-gray max-w-none space-y-6">
        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Introduction</h2>
          <p className="text-gray-700">
            GuestyMigrate ("Service," "we," "us") is committed to protecting your privacy.
            This Privacy Policy explains how we collect, use, store, and protect your information.
            GuestyMigrate is not affiliated with Guesty Inc.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Information We Collect</h2>
          <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Account Information</h3>
          <ul className="list-disc list-inside text-gray-700 space-y-1">
            <li>Email address (for authentication and communication)</li>
            <li>Hashed password (bcrypt, never stored in plaintext)</li>
          </ul>

          <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">API Credentials</h3>
          <ul className="list-disc list-inside text-gray-700 space-y-1">
            <li>Guesty Open API Client IDs and Client Secrets</li>
            <li>Client Secrets are encrypted at rest using AES-256-CBC</li>
            <li>OAuth access tokens are cached temporarily</li>
          </ul>

          <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Payment Information</h3>
          <p className="text-gray-700">
            Payments are processed by Stripe. We do not store credit card numbers.
            We store Stripe session IDs for reconciliation only.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">3. How We Use Your Information</h2>
          <ul className="list-disc list-inside text-gray-700 space-y-1">
            <li>Authentication and account management</li>
            <li>Migration processing between Guesty accounts</li>
            <li>Sending migration completion reports</li>
            <li>Troubleshooting support requests</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Data Storage and Security</h2>
          <ul className="list-disc list-inside text-gray-700 space-y-1">
            <li>All data stored in PostgreSQL with access controls</li>
            <li>API credentials encrypted with AES-256-CBC</li>
            <li>Passwords hashed with bcrypt (cost factor 10)</li>
            <li>JWT sessions with 7-day expiration</li>
            <li>HTTPS and CORS restrictions in production</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Data Retention</h2>
          <ul className="list-disc list-inside text-gray-700 space-y-1">
            <li>Account data retained while active</li>
            <li>Migration logs retained 90 days post-completion</li>
            <li>Cached OAuth tokens expire and auto-renew</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Your Rights</h2>
          <p className="text-gray-700 mb-2">You have the right to:</p>
          <ul className="list-disc list-inside text-gray-700 space-y-1">
            <li>Access your personal data</li>
            <li>Correct inaccurate data</li>
            <li>Request deletion of your account and data</li>
            <li>Export your data in a machine-readable format</li>
            <li>Object to processing of your data</li>
          </ul>
          <p className="text-gray-700 mt-2">
            Contact{' '}
            <a href="mailto:privacy@guestymigrate.com" className="text-indigo-600 hover:text-indigo-700">
              privacy@guestymigrate.com
            </a>{' '}
            to exercise these rights.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Third-Party Services</h2>
          <ul className="list-disc list-inside text-gray-700 space-y-1">
            <li>
              <strong>Stripe</strong> — Payment processing (
              <a href="https://stripe.com/privacy" className="text-indigo-600 hover:text-indigo-700" target="_blank" rel="noopener noreferrer">
                Privacy Policy
              </a>)
            </li>
            <li>
              <strong>SendGrid</strong> — Email delivery (
              <a href="https://www.twilio.com/legal/privacy" className="text-indigo-600 hover:text-indigo-700" target="_blank" rel="noopener noreferrer">
                Privacy Policy
              </a>)
            </li>
            <li>
              <strong>Guesty Open API</strong> — Subject to your Guesty account terms
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Cookies and Local Storage</h2>
          <p className="text-gray-700">
            We use browser localStorage to store authentication tokens (JWT) for session persistence.
            We do not use third-party tracking cookies or analytics.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">9. Contact</h2>
          <p className="text-gray-700">
            For privacy inquiries:{' '}
            <a href="mailto:privacy@guestymigrate.com" className="text-indigo-600 hover:text-indigo-700">
              privacy@guestymigrate.com
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
