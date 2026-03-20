import { useState } from 'react';
import { Link } from 'react-router-dom';

/* ───────────────────────── Data ───────────────────────── */

const features = [
  {
    title: 'Listings & Photos',
    description: 'Property configurations, details, photos, and complex (MTL) parent-child hierarchies — all preserved.',
    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  },
  {
    title: 'Reservations',
    description: 'Direct bookings with listing and guest ID remapping. Channel reservations gracefully skipped.',
    icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  },
  {
    title: 'Guests & Owners',
    description: 'Guest profiles and owner records with automatic 409 deduplication handling.',
    icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
  },
  {
    title: 'Automations & Tasks',
    description: 'Workflow automations and tasks with listing ID remapping preserved.',
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
  },
  {
    title: 'Custom Fields & Fees',
    description: 'Custom field definitions, fee structures, and tax configurations.',
    icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z',
  },
  {
    title: 'Calendar Blocks',
    description: 'Manual availability blocks transferred per listing to keep your calendars in sync.',
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  },
  {
    title: 'Rate Strategies',
    description: 'Pricing rules, seasonal rates, and base pricing configurations migrated with full fidelity.',
    icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  {
    title: 'Saved Replies',
    description: 'Message templates migrated with listing-scoped remapping so your canned responses work instantly.',
    icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z',
  },
];

const steps = [
  {
    step: '1',
    title: 'Connect',
    description: 'Enter your source and destination Guesty API credentials. We validate both accounts instantly.',
  },
  {
    step: '2',
    title: 'Review',
    description: 'See exactly what data will migrate — listings, guests, reservations, and more. Select the categories you need.',
  },
  {
    step: '3',
    title: 'Pay',
    description: 'Choose flat-rate or per-listing pricing. Add optional add-ons. Pay securely via Stripe.',
  },
  {
    step: '4',
    title: 'Migrate',
    description: 'Watch real-time progress as your data transfers. Get a verification report when it\'s done.',
  },
];

const pricingTiers = [
  {
    name: 'Starter', listings: '1 – 10', price: '$149', popular: false,
    features: ['All 11 data categories', 'ID remapping', 'Verification report', 'Email support'],
  },
  {
    name: 'Growth', listings: '11 – 50', price: '$349', popular: false,
    features: ['All 11 data categories', 'ID remapping', 'Verification report', 'Email support'],
  },
  {
    name: 'Professional', listings: '51 – 150', price: '$699', popular: true,
    features: ['All 11 data categories', 'ID remapping', 'Verification report', 'Priority email support'],
  },
  {
    name: 'Business', listings: '151 – 300', price: '$999', popular: false,
    features: ['All 11 data categories', 'ID remapping', 'Verification report', 'Priority email support'],
  },
  {
    name: 'Enterprise', listings: '301 – 500', price: '$1,499', popular: false,
    features: ['All 11 data categories', 'ID remapping', 'Verification report', 'Priority email + phone support'],
  },
  {
    name: 'Enterprise+', listings: '500+', price: 'Custom', popular: false, isCustom: true,
    features: ['All 11 data categories', 'ID remapping', 'Verification report', 'Dedicated migration specialist'],
  },
];

const addons = [
  { name: 'Priority Processing', price: '$99',  description: 'Skip the queue — your migration runs first.' },
  { name: 'Dedicated Support & Review', price: '$149', description: 'A migration specialist reviews your setup and assists during the process.' },
  { name: 'Re-Migration Pass', price: '$79', description: 'One free re-run within 30 days if you need to migrate again.' },
  { name: 'Post-Migration Verify Call', price: '$99', description: '30-minute video call to walk through your destination account.' },
];

const faqs = [
  {
    q: 'How long does a migration take?',
    a: 'Most migrations complete in under 30 minutes. Larger accounts with 100+ listings and thousands of photos may take a couple of hours. You can close the browser and check back — we\'ll email you when it\'s done.',
  },
  {
    q: 'Do I need to disconnect my channels first?',
    a: 'Yes. To avoid booking conflicts, disconnect your channels (Airbnb, Vrbo, Booking.com) from the source account before migrating. You can reconnect them to the destination account after migration completes.',
  },
  {
    q: 'What happens to channel reservations?',
    a: 'Channel reservations (Airbnb, Vrbo, etc.) are automatically skipped — they\'re managed by the OTA and will re-sync when you reconnect channels. Only direct/manual reservations are migrated.',
  },
  {
    q: 'Is my data secure?',
    a: 'Absolutely. All API credentials — Client IDs, Client Secrets, and OAuth tokens — are encrypted with AES-256 at rest and never stored in plain text. We connect to Guesty via their official Open API over HTTPS. You can also export or delete all your data at any time via your account settings.',
  },
  {
    q: 'What if something goes wrong?',
    a: 'The migration engine handles rate limits and recovers from partial failures automatically. If a category fails, you can retry just that category without being charged again. A verification diff report confirms completeness.',
  },
  {
    q: 'Can I choose which data to migrate?',
    a: 'Yes. After connecting, you\'ll see a manifest of all your source data. You can select or deselect individual categories — only pay for what you need.',
  },
];

/* ───────────────────────── Component ───────────────────────── */

export default function Landing() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="bg-slate-900 relative overflow-hidden">
        {/* Subtle grid pattern */}
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage: 'radial-gradient(circle, #f59e0b 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }} />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 lg:py-32 text-center">
          <div className="inline-flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-full px-4 py-1.5 mb-8">
            <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span className="text-sm text-slate-300 font-medium">Built on the Guesty Open API</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white tracking-tight leading-[1.1] mb-6">
            Migrate Your Guesty Account
            <br />
            <span className="text-amber-400">In Minutes, Not Weeks</span>
          </h1>

          <p className="text-lg sm:text-xl text-slate-300 max-w-3xl mx-auto mb-10 leading-relaxed">
            Transfer listings, reservations, guests, photos, rate strategies, saved replies, and 11 data categories
            between Guesty accounts — fully automated with complex listing support and a verification report.
          </p>

          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Link
              to="/register"
              className="bg-amber-500 hover:bg-amber-600 text-slate-900 px-8 py-3.5 rounded-xl text-lg font-semibold shadow-sm hover:shadow-md transition-all duration-200"
            >
              Start Your Migration
            </Link>
            <a
              href="#how-it-works"
              className="border-2 border-slate-600 text-white px-8 py-3.5 rounded-xl text-lg font-semibold hover:bg-slate-800 transition-all duration-200"
            >
              See How It Works
            </a>
          </div>
        </div>
      </section>

      {/* ── Trust Bar ────────────────────────────────────────── */}
      <section className="bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-wrap justify-center items-center gap-6 sm:gap-10">
            <div className="flex items-center gap-2 text-slate-600">
              <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span className="text-sm font-semibold">AES-256 Encrypted</span>
            </div>
            <div className="w-px h-5 bg-stone-200 hidden sm:block" />
            <div className="flex items-center gap-2 text-slate-600">
              <svg className="w-5 h-5 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-sm font-semibold">Guesty Open API</span>
            </div>
            <div className="w-px h-5 bg-stone-200 hidden sm:block" />
            <div className="flex items-center gap-2 text-slate-600">
              <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span className="text-sm font-semibold">11 Data Categories</span>
            </div>
            <div className="w-px h-5 bg-stone-200 hidden sm:block" />
            <div className="flex items-center gap-2 text-slate-600">
              <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm font-semibold">Verification Report</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── How It Works ─────────────────────────────────────── */}
      <section id="how-it-works" className="py-20 sm:py-24 bg-[#fafaf8]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight mb-4">
              Four Steps. That's It.
            </h2>
            <p className="text-lg text-slate-500 max-w-2xl mx-auto">
              No CSVs, no manual data entry, no weeks of tedious work.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {steps.map((s, i) => (
              <div key={s.step} className="relative">
                {i < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-8 left-[calc(50%+40px)] w-[calc(100%-80px)] h-px bg-stone-300" />
                )}
                <div className="text-center">
                  <div className="w-16 h-16 bg-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-sm">
                    <span className="text-2xl font-bold text-slate-900">{s.step}</span>
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-2">{s.title}</h3>
                  <p className="text-slate-500 leading-relaxed">{s.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────── */}
      <section className="py-20 sm:py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight mb-4">
              Everything Migrates. Nothing Left Behind.
            </h2>
            <p className="text-lg text-slate-500 max-w-2xl mx-auto">
              GuestyMigrate handles all 11 data categories with smart dependency ordering and 100% ID remapping.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="bg-[#fafaf8] border border-stone-200 rounded-2xl p-6 hover:shadow-md hover:border-stone-300 transition-all duration-200"
              >
                <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={feature.icon} />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">{feature.title}</h3>
                <p className="text-slate-500 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────── */}
      <section id="pricing" className="py-20 sm:py-24 bg-[#fafaf8]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-4">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight mb-4">
              Simple, Transparent Pricing
            </h2>
            <p className="text-lg text-slate-500 max-w-2xl mx-auto mb-2">
              Pay per migration based on your listing count. No subscriptions, no hidden fees.
            </p>
            <p className="text-sm text-slate-400 max-w-2xl mx-auto">
              Prefer pay-per-listing? Choose the per-listing mode at checkout — graduated rates
              start at <strong>$8/listing</strong> (1–50), then <strong>$5</strong> (51–200), and <strong>$3</strong> (201+), with a flat $79 base fee.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto mt-12">
            {pricingTiers.map((tier) => (
              <div
                key={tier.name}
                className={`bg-white rounded-2xl p-8 flex flex-col transition-all duration-200 ${
                  tier.popular
                    ? 'ring-2 ring-amber-500 shadow-lg scale-[1.03]'
                    : 'border border-stone-200 shadow-sm hover:shadow-md hover:border-stone-300'
                }`}
              >
                {tier.popular && (
                  <span className="inline-block bg-amber-500 text-slate-900 text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wide text-center">
                    Most Popular
                  </span>
                )}
                <h3 className="text-xl font-bold text-slate-900 mb-1">{tier.name}</h3>
                <p className="text-slate-400 mb-4 text-sm">{tier.listings} listings</p>
                <p className="text-4xl font-extrabold text-slate-900 mb-5">{tier.price}</p>
                <ul className="space-y-2 mb-6 flex-1">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-slate-600">
                      <svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                {tier.isCustom ? (
                  <a
                    href="mailto:enterprise@guestymigrate.com?subject=Enterprise%2B%20Migration%20Quote&body=Hi%2C%20I%20have%20over%20500%20listings%20and%20would%20like%20a%20custom%20migration%20quote."
                    className="block w-full py-3 rounded-xl font-semibold transition-all duration-200 bg-stone-100 text-slate-900 hover:bg-stone-200 text-center"
                  >
                    Request a Quote
                  </a>
                ) : (
                  <Link
                    to="/register"
                    className={`block w-full py-3 rounded-xl font-semibold transition-all duration-200 text-center ${
                      tier.popular
                        ? 'bg-amber-500 text-slate-900 hover:bg-amber-600 shadow-sm hover:shadow-md'
                        : 'bg-stone-100 text-slate-900 hover:bg-stone-200'
                    }`}
                  >
                    Get Started
                  </Link>
                )}
              </div>
            ))}
          </div>

          {/* Money-back guarantee */}
          <p className="text-center text-sm text-slate-500 mt-8 flex items-center justify-center gap-2">
            <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span><strong>30-day satisfaction guarantee.</strong> If your migration doesn't complete successfully, we'll make it right or refund you in full.</span>
          </p>

          {/* Add-ons */}
          <div className="mt-16">
            <h3 className="text-2xl font-bold text-slate-900 text-center mb-2">Optional Add-ons</h3>
            <p className="text-slate-500 text-center mb-8 text-sm">Enhance your migration with these optional extras, available at checkout.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto">
              {addons.map((addon) => (
                <div key={addon.name} className="bg-white border border-stone-200 rounded-2xl p-6 text-center hover:shadow-md transition-all duration-200">
                  <p className="text-2xl font-extrabold text-slate-900 mb-1">{addon.price}</p>
                  <p className="text-sm font-semibold text-slate-700 mb-2">{addon.name}</p>
                  <p className="text-xs text-slate-400 leading-relaxed">{addon.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Why GuestyMigrate ────────────────────────────────── */}
      <section className="py-20 sm:py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight mb-4">
              Why Property Managers Choose GuestyMigrate
            </h2>
            <p className="text-lg text-slate-500 max-w-2xl mx-auto">
              Guesty doesn't offer a built-in migration tool between accounts. Manual exports
              and CSV imports lose data relationships, break automations, and take weeks.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <div className="text-center p-6 bg-[#fafaf8] rounded-2xl border border-stone-200">
              <p className="text-5xl font-extrabold text-amber-500 mb-3">11</p>
              <p className="text-slate-700 font-semibold">Data Categories</p>
              <p className="text-sm text-slate-400 mt-1">Migrated automatically</p>
            </div>
            <div className="text-center p-6 bg-[#fafaf8] rounded-2xl border border-stone-200">
              <p className="text-5xl font-extrabold text-amber-500 mb-3">100%</p>
              <p className="text-slate-700 font-semibold">ID Remapping</p>
              <p className="text-sm text-slate-400 mt-1">All relationships preserved</p>
            </div>
            <div className="text-center p-6 bg-[#fafaf8] rounded-2xl border border-stone-200">
              <p className="text-5xl font-extrabold text-amber-500 mb-3">AES-256</p>
              <p className="text-slate-700 font-semibold">Encryption</p>
              <p className="text-sm text-slate-400 mt-1">Credentials secured at rest</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────── */}
      <section className="py-20 sm:py-24 bg-[#fafaf8]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight mb-4">
              Frequently Asked Questions
            </h2>
          </div>

          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <div
                key={i}
                className="bg-white border border-stone-200 rounded-2xl overflow-hidden transition-all duration-200"
              >
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-6 py-5 text-left"
                >
                  <span className="text-base font-semibold text-slate-900 pr-4">{faq.q}</span>
                  <svg
                    className={`w-5 h-5 text-slate-400 flex-shrink-0 transition-transform duration-200 ${openFaq === i ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {openFaq === i && (
                  <div className="px-6 pb-5">
                    <p className="text-slate-500 leading-relaxed">{faq.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────── */}
      <section className="py-20 sm:py-24 bg-slate-900 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage: 'radial-gradient(circle, #f59e0b 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }} />
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-4">
            Ready to Migrate?
          </h2>
          <p className="text-lg text-slate-300 mb-8">
            Set up your migration in under 5 minutes. Pay only for what you need.
          </p>
          <Link
            to="/register"
            className="inline-block bg-amber-500 hover:bg-amber-600 text-slate-900 px-8 py-3.5 rounded-xl text-lg font-semibold shadow-sm hover:shadow-md transition-all duration-200"
          >
            Start Your Migration
          </Link>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="bg-slate-900 border-t border-slate-800 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            {/* Brand */}
            <div>
              <div className="flex items-center space-x-2.5 mb-4">
                <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                  <rect width="32" height="32" rx="8" fill="#f59e0b" />
                  <path d="M8 16 L14 22 L24 10" stroke="#0f172a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-base font-bold text-white">GuestyMigrate</span>
              </div>
              <p className="text-sm text-slate-400 leading-relaxed">
                Self-serve migration tool for Guesty property management accounts.
              </p>
            </div>

            {/* Product */}
            <div>
              <h4 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">Product</h4>
              <ul className="space-y-2">
                <li><a href="#how-it-works" className="text-sm text-slate-400 hover:text-white transition-colors">How It Works</a></li>
                <li><a href="#pricing" className="text-sm text-slate-400 hover:text-white transition-colors">Pricing</a></li>
                <li><Link to="/register" className="text-sm text-slate-400 hover:text-white transition-colors">Get Started</Link></li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">Legal</h4>
              <ul className="space-y-2">
                <li><Link to="/terms" className="text-sm text-slate-400 hover:text-white transition-colors">Terms of Service</Link></li>
                <li><Link to="/privacy" className="text-sm text-slate-400 hover:text-white transition-colors">Privacy Policy</Link></li>
              </ul>
            </div>

            {/* Support */}
            <div>
              <h4 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">Support</h4>
              <ul className="space-y-2">
                <li><a href="mailto:support@guestymigrate.com" className="text-sm text-slate-400 hover:text-white transition-colors">support@guestymigrate.com</a></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-8 flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-sm text-slate-500">
              &copy; {new Date().getFullYear()} GuestyMigrate. Not affiliated with Guesty Inc.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
