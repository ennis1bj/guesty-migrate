import { Link } from 'react-router-dom';

const features = [
  {
    title: 'Automated Migration',
    description: 'Transfer listings, reservations, guests, owners, automations, and tasks automatically.',
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
  },
  {
    title: 'Dependency Ordering',
    description: 'Smart migration order ensures listings are created before reservations that reference them.',
    icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z',
  },
  {
    title: 'Verification Report',
    description: 'After migration, a diff report compares source and destination to confirm completeness.',
    icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  {
    title: 'Secure & Reliable',
    description: 'AES-256 encrypted credentials. Rate limit handling. Partial failure recovery.',
    icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
  },
];

const pricingTiers = [
  { name: 'Starter',       listings: '1 – 10',    price: '$149',   popular: false },
  { name: 'Growth',        listings: '11 – 50',   price: '$349',   popular: false },
  { name: 'Professional',  listings: '51 – 150',  price: '$699',   popular: true },
  { name: 'Business',      listings: '151 – 300', price: '$999',   popular: false },
  { name: 'Enterprise',    listings: '301 – 500', price: '$1,499', popular: false },
  { name: 'Enterprise+',   listings: '500+',      price: 'Custom', popular: false, isCustom: true },
];

export default function Landing() {
  return (
    <div>
      {/* Hero */}
      <section className="bg-gradient-to-br from-indigo-600 to-blue-700 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-6">
            Migrate Your Guesty Account
            <br />
            <span className="text-indigo-200">In Minutes, Not Weeks</span>
          </h1>
          <p className="text-xl text-indigo-100 max-w-3xl mx-auto mb-10">
            GuestyMigrate transfers all your listings, reservations, guests, and more
            from one Guesty account to another — fully automated via the Guesty Open API.
          </p>
          <div className="flex justify-center space-x-4">
            <Link
              to="/register"
              className="bg-white text-indigo-600 px-8 py-3 rounded-lg text-lg font-semibold hover:bg-indigo-50 transition-colors"
            >
              Start Migration
            </Link>
            <a
              href="#pricing"
              className="border-2 border-white text-white px-8 py-3 rounded-lg text-lg font-semibold hover:bg-white hover:text-indigo-600 transition-colors"
            >
              View Pricing
            </a>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
            Everything You Need for a Seamless Migration
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {features.map((feature) => (
              <div key={feature.title} className="text-center p-6">
                <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={feature.icon} />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-gray-600">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">
            Simple, Transparent Pricing
          </h2>
          <p className="text-center text-gray-600 mb-4 max-w-2xl mx-auto">
            Pay per migration based on your listing count. No subscriptions, no hidden fees.
          </p>
          <p className="text-center text-sm text-gray-500 mb-12 max-w-2xl mx-auto">
            Prefer pay-per-listing? Choose the per-listing mode at checkout for graduated rates starting at $8/listing.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {pricingTiers.map((tier) => (
              <div
                key={tier.name}
                className={`bg-white rounded-2xl p-8 text-center ${
                  tier.popular
                    ? 'ring-2 ring-indigo-600 shadow-lg scale-105'
                    : 'border border-gray-200 shadow-sm'
                }`}
              >
                {tier.popular && (
                  <span className="inline-block bg-indigo-600 text-white text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wide">
                    Most Popular
                  </span>
                )}
                <h3 className="text-xl font-bold text-gray-900 mb-2">{tier.name}</h3>
                <p className="text-gray-500 mb-4">{tier.listings} listings</p>
                <p className="text-4xl font-extrabold text-gray-900 mb-6">{tier.price}</p>
                {tier.isCustom ? (
                  <a
                    href="mailto:support@guestymigrate.com?subject=Enterprise%20Migration%20Quote"
                    className="block w-full py-3 rounded-lg font-semibold transition-colors bg-gray-100 text-gray-900 hover:bg-gray-200"
                  >
                    Contact Us
                  </a>
                ) : (
                  <Link
                    to="/register"
                    className={`block w-full py-3 rounded-lg font-semibold transition-colors ${
                      tier.popular
                        ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                        : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                    }`}
                  >
                    Get Started
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why GuestyMigrate */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">
            Why GuestyMigrate?
          </h2>
          <p className="text-center text-gray-600 mb-12 max-w-2xl mx-auto">
            Guesty doesn't offer a built-in migration tool between accounts. Manual exports and CSV
            imports lose data relationships, break automations, and take weeks of tedious work.
            GuestyMigrate does it in minutes.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <div className="text-center">
              <p className="text-4xl font-extrabold text-indigo-600 mb-2">9</p>
              <p className="text-gray-700 font-medium">Data categories migrated</p>
            </div>
            <div className="text-center">
              <p className="text-4xl font-extrabold text-indigo-600 mb-2">100%</p>
              <p className="text-gray-700 font-medium">ID remapping preserved</p>
            </div>
            <div className="text-center">
              <p className="text-4xl font-extrabold text-indigo-600 mb-2">AES-256</p>
              <p className="text-gray-700 font-medium">Credential encryption</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
            <p className="text-sm">
              &copy; {new Date().getFullYear()} GuestyMigrate. Not affiliated with Guesty Inc.
            </p>
            <div className="flex space-x-6 text-sm">
              <a href="/terms" className="hover:text-white transition-colors">Terms of Service</a>
              <a href="/privacy" className="hover:text-white transition-colors">Privacy Policy</a>
              <a href="mailto:support@guestymigrate.com" className="hover:text-white transition-colors">Support</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
