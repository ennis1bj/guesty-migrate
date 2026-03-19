export default function Terms() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Terms of Service</h1>
      <p className="text-sm text-gray-500 mb-8">Last updated: March 2026</p>

      <div className="prose prose-gray max-w-none space-y-6">
        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Acceptance of Terms</h2>
          <p className="text-gray-700">
            By accessing or using GuestyMigrate ("Service"), you agree to be bound by these Terms of
            Service ("Terms"). If you do not agree to these Terms, do not use the Service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Description of Service</h2>
          <p className="text-gray-700">
            GuestyMigrate is a self-serve data migration tool that transfers data between Guesty.com
            property management accounts using the Guesty Open API. The Service is not affiliated
            with, endorsed by, or sponsored by Guesty Inc.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">3. User Accounts</h2>
          <ul className="list-disc list-inside text-gray-700 space-y-1">
            <li>You must provide a valid email address and create a password to use the Service.</li>
            <li>You are responsible for maintaining the confidentiality of your account credentials.</li>
            <li>You are responsible for all activities that occur under your account.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">4. API Credentials</h2>
          <ul className="list-disc list-inside text-gray-700 space-y-1">
            <li>You provide Guesty Open API credentials for both source and destination accounts.</li>
            <li>Your API credentials are encrypted at rest using AES-256-CBC encryption.</li>
            <li>You are responsible for ensuring you have authorization to access and migrate data from both accounts.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Payment and Refunds</h2>
          <ul className="list-disc list-inside text-gray-700 space-y-1">
            <li>The Service uses one-time payments processed through Stripe.</li>
            <li>Pricing is based on the number of listings in the source account.</li>
            <li>Payments are non-refundable once a migration has begun processing.</li>
            <li>If a migration fails due to a Service error, contact support to discuss resolution.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Limitations</h2>
          <p className="text-gray-700">
            Channel-managed reservations (Airbnb, Vrbo, Booking.com, etc.) are not migrated.
            Task assignees are not remapped between accounts. The Service does not guarantee
            100% data fidelity due to Guesty API limitations.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Disclaimer of Warranties</h2>
          <p className="text-gray-700 uppercase text-sm">
            The Service is provided "as is" and "as available" without warranties of any kind,
            either express or implied, including but not limited to implied warranties of
            merchantability, fitness for a particular purpose, and non-infringement.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Limitation of Liability</h2>
          <p className="text-gray-700 uppercase text-sm">
            In no event shall GuestyMigrate be liable for any indirect, incidental, special,
            consequential, or punitive damages, or any loss of data, revenue, or profits,
            arising out of your use of the Service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">9. Contact</h2>
          <p className="text-gray-700">
            For questions about these Terms, contact us at{' '}
            <a href="mailto:support@guestymigrate.com" className="text-indigo-600 hover:text-indigo-700">
              support@guestymigrate.com
            </a>.
          </p>
        </section>
      </div>
    </div>
  );
}
