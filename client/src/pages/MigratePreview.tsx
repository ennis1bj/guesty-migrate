import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

const STEPS = ['Credentials', 'Review', 'Payment', 'Progress'];

const DEMO_CATEGORIES = [
  { key: 'listings',       label: 'Listings',        count: 47  },
  { key: 'photos',         label: 'Photos',          count: 1842 },
  { key: 'guests',         label: 'Guests',          count: 312 },
  { key: 'reservations',   label: 'Reservations',    count: 486 },
  { key: 'rate_strategies',label: 'Rate Strategies', count: 14  },
  { key: 'automations',    label: 'Automations',     count: 22  },
  { key: 'tasks',          label: 'Tasks',            count: 8   },
  { key: 'saved_replies',  label: 'Saved Replies',   count: 31  },
  { key: 'custom_fields',  label: 'Custom Fields',   count: 6   },
  { key: 'fees',           label: 'Fees',             count: 9   },
  { key: 'calendar_blocks',label: 'Calendar Blocks', count: 203 },
];

const DEMO_PROGRESS = [
  { label: 'Custom Fields',   pct: 100, status: 'complete' },
  { label: 'Rate Strategies', pct: 100, status: 'complete' },
  { label: 'Listings',        pct: 100, status: 'complete' },
  { label: 'Photos',          pct: 68,  status: 'running'  },
  { label: 'Guests',          pct: 100, status: 'complete' },
  { label: 'Reservations',    pct: 41,  status: 'running'  },
  { label: 'Automations',     pct: 0,   status: 'pending'  },
  { label: 'Saved Replies',   pct: 0,   status: 'pending'  },
];

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center">
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all ${
            i === currentStep
              ? 'bg-amber-500 text-slate-900'
              : i < currentStep
              ? 'bg-slate-200 text-slate-600'
              : 'bg-white border border-stone-200 text-slate-400'
          }`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
              i < currentStep ? 'bg-emerald-500 text-white' : i === currentStep ? 'bg-slate-900 text-white' : 'bg-stone-200 text-slate-500'
            }`}>
              {i < currentStep ? '✓' : i + 1}
            </span>
            {label}
          </div>
          {i < STEPS.length - 1 && (
            <div className={`w-8 h-px mx-1 ${i < currentStep ? 'bg-emerald-400' : 'bg-stone-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function CredentialsStep() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-1">New Migration</h1>
      <p className="text-slate-500 mb-8">Follow the steps below to migrate your Guesty account data.</p>
      <StepIndicator currentStep={0} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {[
          { label: 'Source Account', sub: 'The Guesty account you are migrating FROM', validated: true },
          { label: 'Destination Account', sub: 'The Guesty account you are migrating TO', validated: false },
        ].map((acct) => (
          <div key={acct.label} className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2.5 h-2.5 rounded-full ${acct.validated ? 'bg-emerald-500' : 'bg-stone-300'}`} />
              <h2 className="text-lg font-bold text-slate-900">{acct.label}</h2>
            </div>
            <p className="text-sm text-slate-400 mb-5">{acct.sub}</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Client ID</label>
                <input
                  type="text"
                  readOnly
                  value={acct.validated ? 'gst_live_4Xk9mNpQ2rT8wBvY•••••••' : ''}
                  placeholder="Enter your Guesty Client ID"
                  className="w-full border border-stone-200 rounded-xl px-4 py-2.5 text-sm text-slate-700 bg-stone-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Client Secret</label>
                <input
                  type="password"
                  readOnly
                  value={acct.validated ? 'placeholder' : ''}
                  placeholder="Enter your Guesty Client Secret"
                  className="w-full border border-stone-200 rounded-xl px-4 py-2.5 text-sm text-slate-700 bg-stone-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
              {acct.validated ? (
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl px-4 py-2.5 text-sm font-semibold">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Account validated — 47 listings found
                </div>
              ) : (
                <button className="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold py-2.5 rounded-xl text-sm transition-colors">
                  Validate Account
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 text-sm text-amber-800">
        <span className="font-semibold">Before you start:</span> Disconnect your channels (Airbnb, Vrbo, Booking.com) from the source account to avoid booking conflicts.
      </div>

      <div className="mt-6 flex justify-end">
        <button className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold px-8 py-3 rounded-xl text-sm transition-colors opacity-50 cursor-not-allowed">
          Validate &amp; Continue →
        </button>
      </div>
    </div>
  );
}

function ReviewStep() {
  const [selected, setSelected] = useState<string[]>(DEMO_CATEGORIES.map((c) => c.key));
  const toggle = (k: string) =>
    setSelected((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-1">New Migration</h1>
      <p className="text-slate-500 mb-8">Follow the steps below to migrate your Guesty account data.</p>
      <StepIndicator currentStep={1} />

      <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-stone-100">
          <h2 className="text-xl font-bold text-slate-900">Your Migration Manifest</h2>
          <p className="text-slate-500 text-sm mt-0.5">Review what will be migrated. Deselect any categories you don't need.</p>
        </div>
        <table className="w-full">
          <thead className="bg-stone-50 border-b border-stone-100">
            <tr>
              <th className="text-left px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Data Category</th>
              <th className="text-right px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Source Count</th>
              <th className="text-center px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Include</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50">
            {DEMO_CATEGORIES.map((cat) => (
              <tr key={cat.key} className="hover:bg-stone-50 transition-colors">
                <td className="px-6 py-3.5">
                  <span className="text-sm font-medium text-slate-800">{cat.label}</span>
                </td>
                <td className="px-6 py-3.5 text-right">
                  <span className="text-sm text-slate-600 font-mono">{cat.count.toLocaleString()}</span>
                </td>
                <td className="px-6 py-3.5 text-center">
                  <button
                    onClick={() => toggle(cat.key)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${selected.includes(cat.key) ? 'bg-amber-500' : 'bg-stone-200'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${selected.includes(cat.key) ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-6 py-4 border-t border-stone-100 bg-stone-50 flex justify-between items-center">
          <p className="text-sm text-slate-500">{selected.length} of {DEMO_CATEGORIES.length} categories selected</p>
          <button className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold px-8 py-2.5 rounded-xl text-sm transition-colors">
            Continue to Payment →
          </button>
        </div>
      </div>
    </div>
  );
}

function PaymentStep() {
  const [mode, setMode] = useState<'flat' | 'per'>('flat');
  const tiers = [
    { name: 'Growth',       range: '11 – 50',   price: '$349', cents: 34900 },
    { name: 'Professional', range: '51 – 150',  price: '$699', cents: 69900, popular: true },
    { name: 'Business',     range: '151 – 300', price: '$999', cents: 99900 },
  ];
  const addons = [
    { key: 'priority',  name: 'Priority Processing',        price: '$99',  desc: 'Skip the queue — your migration runs first.' },
    { key: 'support',   name: 'Dedicated Support & Review', price: '$149', desc: 'A migration specialist assists throughout.' },
    { key: 'remigrate', name: 'Re-Migration Pass',          price: '$79',  desc: 'One free re-run within 30 days.' },
    { key: 'verify',    name: 'Post-Migration Verify Call', price: '$99',  desc: '30-min call to review your results.' },
  ];
  const [selectedAddons, setSelectedAddons] = useState<string[]>([]);
  const toggle = (k: string) => setSelectedAddons((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-1">New Migration</h1>
      <p className="text-slate-500 mb-8">Follow the steps below to migrate your Guesty account data.</p>
      <StepIndicator currentStep={2} />

      <div className="flex justify-center mb-6">
        <div className="inline-flex bg-stone-100 rounded-xl p-1">
          {(['flat', 'per'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {m === 'flat' ? 'Flat Tier' : 'Per-Listing'}
            </button>
          ))}
        </div>
      </div>

      {mode === 'flat' ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          {tiers.map((t) => (
            <div key={t.name} className={`bg-white rounded-2xl p-6 border transition-all cursor-pointer ${t.popular ? 'ring-2 ring-amber-500 shadow-md scale-[1.02]' : 'border-stone-200 hover:border-stone-300 hover:shadow-sm'}`}>
              {t.popular && <span className="inline-block bg-amber-500 text-slate-900 text-xs font-bold px-3 py-1 rounded-full mb-3 uppercase">Most Popular</span>}
              <h3 className="text-lg font-bold text-slate-900 mb-1">{t.name}</h3>
              <p className="text-slate-400 text-sm mb-3">{t.range} listings</p>
              <p className="text-4xl font-extrabold text-slate-900 mb-4">{t.price}</p>
              <button className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-colors ${t.popular ? 'bg-amber-500 text-slate-900 hover:bg-amber-600' : 'bg-stone-100 text-slate-900 hover:bg-stone-200'}`}>
                Select Plan
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white border border-stone-200 rounded-2xl p-8 mb-6 text-center">
          <h3 className="text-xl font-bold text-slate-900 mb-2">Graduated Per-Listing Pricing</h3>
          <p className="text-slate-500 mb-4">Base fee of <span className="font-semibold">$39</span> plus a per-listing rate that decreases as you scale</p>
          <div className="max-w-xs mx-auto space-y-2 text-left">
            {[['1 – 10 listings', '$12 / listing'], ['11 – 50 listings', '$8 / listing'], ['51 – 150 listings', '$5 / listing']].map(([r, p]) => (
              <div key={r} className="flex justify-between py-2 border-b border-stone-100">
                <span className="text-slate-600 text-sm">{r}</span>
                <span className="font-semibold text-slate-900 text-sm">{p}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 bg-amber-50 rounded-xl px-4 py-3 text-sm text-amber-800">
            <span className="font-semibold">Your estimate:</span> 47 listings = $39 + (10×$12) + (37×$8) = <span className="font-bold">$455</span>
          </div>
        </div>
      )}

      <div className="bg-white border border-stone-200 rounded-2xl p-6 mb-6">
        <h3 className="text-base font-bold text-slate-900 mb-4">Optional Add-Ons</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {addons.map((a) => (
            <div
              key={a.key}
              onClick={() => toggle(a.key)}
              className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all ${selectedAddons.includes(a.key) ? 'border-amber-400 bg-amber-50' : 'border-stone-200 hover:border-stone-300'}`}
            >
              <div className={`w-5 h-5 rounded border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${selectedAddons.includes(a.key) ? 'bg-amber-500 border-amber-500' : 'border-stone-300'}`}>
                {selectedAddons.includes(a.key) && <svg className="w-3 h-3 text-slate-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{a.name}</p>
                  <span className="text-sm font-bold text-amber-600 flex-shrink-0">{a.price}</span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{a.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-between items-center bg-white border border-stone-200 rounded-2xl px-6 py-4">
        <div>
          <p className="text-sm text-slate-500">Total due today</p>
          <p className="text-2xl font-extrabold text-slate-900">$699</p>
        </div>
        <button className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold px-8 py-3 rounded-xl transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
          Pay Securely via Stripe
        </button>
      </div>
    </div>
  );
}

function ProgressStep() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-1">New Migration</h1>
      <p className="text-slate-500 mb-8">Follow the steps below to migrate your Guesty account data.</p>
      <StepIndicator currentStep={3} />

      <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden mb-6">
        <div className="px-6 py-5 border-b border-stone-100 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Migration In Progress</h2>
            <p className="text-sm text-slate-500 mt-0.5">Migrating 47 listings and 11 data categories</p>
          </div>
          <span className="flex items-center gap-2 text-sm font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
            Running
          </span>
        </div>
        <div className="px-6 py-5 space-y-4">
          {DEMO_PROGRESS.map((row) => (
            <div key={row.label}>
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-sm font-medium text-slate-700">{row.label}</span>
                <span className={`text-sm font-semibold ${
                  row.status === 'complete' ? 'text-emerald-600' :
                  row.status === 'running'  ? 'text-amber-600' : 'text-slate-400'
                }`}>
                  {row.status === 'complete' ? '✓ Complete' :
                   row.status === 'running'  ? `${row.pct}%` : 'Pending'}
                </span>
              </div>
              <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    row.status === 'complete' ? 'bg-emerald-500' :
                    row.status === 'running'  ? 'bg-amber-500' : 'bg-stone-200'
                  }`}
                  style={{ width: `${row.pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-6 py-4 text-sm text-emerald-700">
        <p className="font-semibold mb-1">You can safely close this tab.</p>
        <p>The migration runs in the background. We'll email you when it's done and your verification report is ready.</p>
      </div>
    </div>
  );
}

export default function MigratePreview() {
  const [searchParams] = useSearchParams();
  const step = parseInt(searchParams.get('step') || '0', 10);

  return (
    <div className="min-h-screen bg-[#fafaf8]">
      {step === 0 && <CredentialsStep />}
      {step === 1 && <ReviewStep />}
      {step === 2 && <PaymentStep />}
      {step === 3 && <ProgressStep />}
    </div>
  );
}
