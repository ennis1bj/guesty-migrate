import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import StepWizard from '../components/StepWizard';
import ManifestCard from '../components/ManifestCard';
import ProgressBar from '../components/ProgressBar';
import DiffReport from '../components/DiffReport';

const STEPS = [
  { label: 'Credentials', description: 'API keys' },
  { label: 'Review', description: 'Select data' },
  { label: 'Payment', description: 'Checkout' },
  { label: 'Progress', description: 'Migration' },
];

const ALL_CATEGORIES = ['custom_fields', 'fees', 'taxes', 'listings', 'guests', 'owners', 'reservations', 'automations', 'tasks'];

type PricingMode = 'flat_tier' | 'per_listing';
type AddOnKey = 'priority' | 'support' | 'remigrate' | 'verify';

interface Pricing {
  tier: string;
  amountCents?: number;
  perListingCents?: number;
  requiresQuote?: boolean;
}

interface AddOnInfo {
  key: AddOnKey;
  name: string;
  description: string;
  priceCents: number;
}

const ADD_ONS: AddOnInfo[] = [
  { key: 'priority',  name: 'Priority Processing',          description: 'Skip the queue — your migration runs first.',                              priceCents: 9900 },
  { key: 'support',   name: 'Dedicated Support & Review',   description: 'A migration specialist reviews your setup and assists during the process.',  priceCents: 14900 },
  { key: 'remigrate', name: 'Re-Migration Pass',            description: 'One free re-run within 30 days if you need to migrate again.',               priceCents: 7900 },
  { key: 'verify',    name: 'Post-Migration Verify Call',   description: '30-minute video call to walk through your destination account.',             priceCents: 9900 },
];

interface MigrationStatus {
  id: string;
  status: string;
  manifest: Record<string, number>;
  results: Record<string, { sourceCount: number; migratedCount: number; failedCount: number }> | null;
  diff_report: Record<string, {
    source?: number;
    destination?: number;
    match?: boolean;
    found?: number;
    migrated?: number;
    skipped_channel_managed?: number;
    failed?: number;
  }> | null;
  logs: Array<{
    category: string;
    status: string;
    source_count: number;
    migrated_count: number;
    failed_count: number;
  }>;
}

/**
 * Compute per-listing graduated price (mirrors server logic).
 *   Base: $79 + $8/listing (1-50) + $5/listing (51-200) + $3/listing (201+)
 */
function calculatePerListingCents(listingCount: number): number {
  let total = 7900; // base
  const t1 = Math.min(listingCount, 50);
  total += t1 * 800;
  const t2 = Math.min(Math.max(listingCount - 50, 0), 150);
  total += t2 * 500;
  const t3 = Math.max(listingCount - 200, 0);
  total += t3 * 300;
  return total;
}

export default function Migrate() {
  const { user } = useAuth();
  const isDemo = !!user?.is_demo;
  const [searchParams] = useSearchParams();
  const [currentStep, setCurrentStep] = useState(0);
  const [migrationId, setMigrationId] = useState<string | null>(null);

  // Step 1: Credentials
  const [sourceClientId, setSourceClientId] = useState('');
  const [sourceClientSecret, setSourceClientSecret] = useState('');
  const [destClientId, setDestClientId] = useState('');
  const [destClientSecret, setDestClientSecret] = useState('');

  // Step 2: Manifest
  const [manifest, setManifest] = useState<Record<string, number> | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(ALL_CATEGORIES);
  const [pricing, setPricing] = useState<Pricing | null>(null);

  // Step 3: Payment options
  const [pricingMode, setPricingMode] = useState<PricingMode>('flat_tier');
  const [selectedAddOns, setSelectedAddOns] = useState<AddOnKey[]>([]);

  // Step 4: Progress
  const [migrationStatus, setMigrationStatus] = useState<MigrationStatus | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [channelConfirmed, setChannelConfirmed] = useState(false);
  const [showQuoteModal, setShowQuoteModal] = useState(false);

  // Handle returning from Stripe checkout
  useEffect(() => {
    const step = searchParams.get('step');
    const id = searchParams.get('migrationId');
    if (step === 'progress' && id) {
      setMigrationId(id);
      setCurrentStep(3);
    }
  }, [searchParams]);

  // Poll migration status
  const pollStatus = useCallback(async () => {
    if (!migrationId) return;
    try {
      const { data } = await api.get(`/migrations/${migrationId}/status`);
      setMigrationStatus(data);
      return data.status;
    } catch {
      return null;
    }
  }, [migrationId]);

  useEffect(() => {
    if (currentStep !== 3 || !migrationId) return;

    pollStatus();
    let pollCount = 0;
    const MAX_POLLS = 450;
    const interval = setInterval(async () => {
      pollCount++;
      const status = await pollStatus();
      if (status === 'complete' || status === 'complete_with_errors' || status === 'failed') {
        clearInterval(interval);
      } else if (pollCount >= MAX_POLLS) {
        clearInterval(interval);
        setError('Status polling timed out after 30 minutes. Your migration may still be running — check back on the Dashboard.');
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [currentStep, migrationId, pollStatus]);

  const handlePreflight = async () => {
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/migrations/preflight', {
        sourceClientId,
        sourceClientSecret,
        destClientId,
        destClientSecret,
      });
      setMigrationId(data.migrationId);
      setManifest(data.manifest);
      setPricing(data.pricing);
      setCurrentStep(1);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to connect to Guesty accounts');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckout = async () => {
    if (!migrationId) return;
    if (pricing?.requiresQuote) {
      setShowQuoteModal(true);
      return;
    }
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post(`/migrations/${migrationId}/checkout`, {
        selectedCategories,
        pricingMode,
        addOns: selectedAddOns,
      });
      window.location.href = data.checkoutUrl;
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create checkout session');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoActivate = async () => {
    if (!migrationId) return;
    setError('');
    setLoading(true);
    try {
      await api.post(`/migrations/${migrationId}/demo-activate`, { selectedCategories });
      setCurrentStep(3);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to activate demo migration');
    } finally {
      setLoading(false);
    }
  };

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]
    );
  };

  const toggleAddOn = (addon: AddOnKey) => {
    setSelectedAddOns((prev) =>
      prev.includes(addon) ? prev.filter((a) => a !== addon) : [...prev, addon]
    );
  };

  const formatPrice = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  // Compute totals
  const flatCents = pricing?.amountCents || 0;
  const perListingCents = manifest ? calculatePerListingCents(manifest.listings) : 0;
  const addonTotal = selectedAddOns.reduce((sum, key) => {
    const a = ADD_ONS.find((ao) => ao.key === key);
    return sum + (a?.priceCents || 0);
  }, 0);
  const baseCents = pricingMode === 'flat_tier' ? flatCents : perListingCents;
  const grandTotal = baseCents + addonTotal;

  // Best value badge
  const flatIsBetter = flatCents <= perListingCents;

  const downloadReport = () => {
    if (!migrationStatus?.diff_report) return;
    const blob = new Blob([JSON.stringify(migrationStatus.diff_report, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `migration-report-${migrationId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isTerminal = migrationStatus && ['complete', 'complete_with_errors', 'failed'].includes(migrationStatus.status);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">New Migration</h1>
      <p className="text-gray-600 mb-8">Follow the steps below to migrate your Guesty account data.</p>

      <StepWizard steps={STEPS} currentStep={currentStep} />

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* ── Quote Modal (enterprise_plus) ──────────────────────────────── */}
      {showQuoteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Custom Quote Required</h3>
            <p className="text-gray-600 mb-4">
              Accounts with 500+ listings require a custom migration plan. Our team will
              assess your account and provide a tailored quote within 24 hours.
            </p>
            <a
              href="mailto:support@guestymigrate.com?subject=Enterprise%20Migration%20Quote&body=I%20have%20500%2B%20listings%20and%20need%20a%20custom%20migration%20quote."
              className="block w-full text-center bg-indigo-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors mb-3"
            >
              Contact Us for a Quote
            </a>
            <button
              onClick={() => setShowQuoteModal(false)}
              className="block w-full text-center text-gray-500 hover:text-gray-700 text-sm"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── Step 1: Credentials ────────────────────────────────────────── */}
      {currentStep === 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Enter API Credentials</h2>

          <div className="space-y-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-semibold text-blue-900 mb-3">Source Account (migrate FROM)</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Client ID</label>
                  <input
                    type="text"
                    value={sourceClientId}
                    onChange={(e) => setSourceClientId(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                    placeholder="Source Client ID"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Client Secret</label>
                  <input
                    type="password"
                    value={sourceClientSecret}
                    onChange={(e) => setSourceClientSecret(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                    placeholder="Source Client Secret"
                  />
                </div>
              </div>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <h3 className="font-semibold text-green-900 mb-3">Destination Account (migrate TO)</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Client ID</label>
                  <input
                    type="text"
                    value={destClientId}
                    onChange={(e) => setDestClientId(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                    placeholder="Destination Client ID"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Client Secret</label>
                  <input
                    type="password"
                    value={destClientSecret}
                    onChange={(e) => setDestClientSecret(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                    placeholder="Destination Client Secret"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <h3 className="font-semibold text-amber-900 mb-3">{"\u26A0\uFE0F"} Before you begin</h3>
            <p className="text-sm text-amber-800 mb-3">
              To avoid booking conflicts, disconnect your channels from the source
              account before migrating. You can reconnect them to the destination
              account after migration completes.
            </p>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={channelConfirmed}
                onChange={(e) => setChannelConfirmed(e.target.checked)}
                className="w-4 h-4 text-indigo-600 rounded"
              />
              <span className="text-sm text-amber-900 font-medium">
                I have disconnected all channels (Airbnb, Vrbo, Booking.com) from
                the source Guesty account
              </span>
            </label>
          </div>

          <button
            onClick={handlePreflight}
            disabled={loading || !sourceClientId || !sourceClientSecret || !destClientId || !destClientSecret || !channelConfirmed}
            className="mt-6 bg-indigo-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Connecting...' : 'Connect & Analyze'}
          </button>
        </div>
      )}

      {/* ── Step 2: Manifest & Selection ───────────────────────────────── */}
      {currentStep === 1 && manifest && pricing && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Source Account Data</h2>
          <p className="text-gray-600 mb-6">Select the categories you want to migrate.</p>

          <ManifestCard
            manifest={Object.fromEntries(
              Object.entries(manifest).filter(([k]) => !['photos'].includes(k))
            )}
            selectedCategories={selectedCategories}
            onToggleCategory={toggleCategory}
          />

          {manifest.photos !== undefined && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-2">
              <span className="text-blue-600 text-lg">{"\uD83D\uDCF7"}</span>
              <p className="text-sm text-blue-800">
                <strong>{manifest.photos.toLocaleString()} photos</strong> found across
                all listings — native listing photos will be migrated automatically
                when Listings is selected. Channel-connected listing photos re-sync
                when you reconnect channels. Calendar blocks are also transferred
                per listing.
              </p>
            </div>
          )}

          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            {"\u26A0\uFE0F"} <strong>Before running:</strong> Disconnect all channels (Airbnb, Vrbo,
            Booking.com) from the source account. Channel reservations cannot be
            migrated and will be skipped automatically.
          </div>

          <div className="mt-8 p-4 bg-gray-50 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Migration Price</p>
              {pricing.requiresQuote ? (
                <>
                  <p className="text-2xl font-bold text-gray-900">Custom Quote</p>
                  <p className="text-sm text-gray-500">500+ listings</p>
                </>
              ) : (
                <>
                  <p className="text-3xl font-bold text-gray-900">from {formatPrice(Math.min(flatCents, perListingCents))}</p>
                  <p className="text-sm text-gray-500 capitalize">{pricing.tier} tier</p>
                </>
              )}
            </div>
            {pricing.requiresQuote ? (
              <button
                onClick={() => setShowQuoteModal(true)}
                className="bg-indigo-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors"
              >
                Contact Us for a Quote
              </button>
            ) : (
              <button
                onClick={() => setCurrentStep(2)}
                disabled={selectedCategories.length === 0}
                className="bg-indigo-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                Continue to Payment
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Step 3: Payment ────────────────────────────────────────────── */}
      {currentStep === 2 && pricing && !pricing.requiresQuote && manifest && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <div className="max-w-2xl mx-auto">
            <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2 text-center">Choose Your Pricing</h2>
            <p className="text-gray-600 mb-8 text-center">
              Select a pricing mode and any optional add-ons for your migration.
            </p>

            {/* ── Pricing Mode Toggle ──────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
              {/* Flat Rate */}
              <button
                onClick={() => setPricingMode('flat_tier')}
                className={`relative p-5 rounded-xl border-2 text-left transition-all ${
                  pricingMode === 'flat_tier'
                    ? 'border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {flatIsBetter && (
                  <span className="absolute -top-2.5 left-4 bg-green-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                    Best value
                  </span>
                )}
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    pricingMode === 'flat_tier' ? 'border-indigo-600' : 'border-gray-300'
                  }`}>
                    {pricingMode === 'flat_tier' && <div className="w-2 h-2 rounded-full bg-indigo-600" />}
                  </div>
                  <span className="font-semibold text-gray-900">Flat Rate</span>
                </div>
                <p className="text-2xl font-bold text-gray-900 ml-7">{formatPrice(flatCents)}</p>
                <p className="text-sm text-gray-500 ml-7 capitalize">{pricing.tier} tier — {manifest.listings} listings</p>
              </button>

              {/* Per Listing */}
              <button
                onClick={() => setPricingMode('per_listing')}
                className={`relative p-5 rounded-xl border-2 text-left transition-all ${
                  pricingMode === 'per_listing'
                    ? 'border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {!flatIsBetter && (
                  <span className="absolute -top-2.5 left-4 bg-green-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                    Best value
                  </span>
                )}
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    pricingMode === 'per_listing' ? 'border-indigo-600' : 'border-gray-300'
                  }`}>
                    {pricingMode === 'per_listing' && <div className="w-2 h-2 rounded-full bg-indigo-600" />}
                  </div>
                  <span className="font-semibold text-gray-900">Per Listing</span>
                </div>
                <p className="text-2xl font-bold text-gray-900 ml-7">{formatPrice(perListingCents)}</p>
                <p className="text-sm text-gray-500 ml-7">$79 base + graduated per-listing rate</p>
              </button>
            </div>

            {/* ── Per-listing rate breakdown ────────────────────────────── */}
            {pricingMode === 'per_listing' && (
              <div className="mb-8 p-4 bg-gray-50 rounded-xl text-sm">
                <h4 className="font-semibold text-gray-700 mb-2">Rate Breakdown</h4>
                <table className="w-full text-left">
                  <tbody className="text-gray-600">
                    <tr><td className="py-0.5">Base fee</td><td className="text-right font-medium">$79.00</td></tr>
                    {manifest.listings > 0 && (
                      <tr>
                        <td className="py-0.5">Listings 1–{Math.min(manifest.listings, 50)} @ $8.00</td>
                        <td className="text-right font-medium">${(Math.min(manifest.listings, 50) * 8).toFixed(2)}</td>
                      </tr>
                    )}
                    {manifest.listings > 50 && (
                      <tr>
                        <td className="py-0.5">Listings 51–{Math.min(manifest.listings, 200)} @ $5.00</td>
                        <td className="text-right font-medium">${(Math.min(Math.max(manifest.listings - 50, 0), 150) * 5).toFixed(2)}</td>
                      </tr>
                    )}
                    {manifest.listings > 200 && (
                      <tr>
                        <td className="py-0.5">Listings 201–{manifest.listings} @ $3.00</td>
                        <td className="text-right font-medium">${(Math.max(manifest.listings - 200, 0) * 3).toFixed(2)}</td>
                      </tr>
                    )}
                    <tr className="border-t border-gray-200">
                      <td className="pt-2 font-semibold text-gray-900">Total</td>
                      <td className="pt-2 text-right font-bold text-gray-900">{formatPrice(perListingCents)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Optional Add-ons ─────────────────────────────────────── */}
            <div className="mb-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Optional Add-ons</h3>
              <div className="space-y-3">
                {ADD_ONS.map((addon) => (
                  <label
                    key={addon.key}
                    className={`flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                      selectedAddOns.includes(addon.key)
                        ? 'border-indigo-600 bg-indigo-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedAddOns.includes(addon.key)}
                      onChange={() => toggleAddOn(addon.key)}
                      className="mt-1 w-4 h-4 text-indigo-600 rounded"
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-gray-900">{addon.name}</span>
                        <span className="font-bold text-gray-900">{formatPrice(addon.priceCents)}</span>
                      </div>
                      <p className="text-sm text-gray-500 mt-0.5">{addon.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* ── Order Summary ─────────────────────────────────────────── */}
            <div className="p-4 bg-gray-50 rounded-xl mb-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Order Summary</h3>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">
                    {pricingMode === 'flat_tier' ? `${pricing.tier} flat rate` : `Per-listing (${manifest.listings} listings)`}
                  </span>
                  <span className="font-medium text-gray-900">{formatPrice(baseCents)}</span>
                </div>
                {selectedAddOns.map((key) => {
                  const a = ADD_ONS.find((ao) => ao.key === key);
                  return a ? (
                    <div key={key} className="flex justify-between">
                      <span className="text-gray-600">{a.name}</span>
                      <span className="font-medium text-gray-900">{formatPrice(a.priceCents)}</span>
                    </div>
                  ) : null;
                })}
                <div className="flex justify-between pt-2 border-t border-gray-200">
                  <span className="font-semibold text-gray-900">Total</span>
                  <span className="font-bold text-lg text-gray-900">{formatPrice(grandTotal)}</span>
                </div>
              </div>
            </div>

            {/* ── What's included ───────────────────────────────────────── */}
            <div className="p-4 bg-gray-50 rounded-xl text-left mb-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">What's included</h3>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>{"\u2705"} Listings, guests, owners, reservations (direct only)</li>
                <li>{"\u2705"} Automations and tasks</li>
                <li>{"\u2705"} Custom fields, fees, and taxes</li>
                <li>{"\u2705"} Native listing photos</li>
                <li>{"\u2705"} Calendar blocks</li>
                <li>{"\u2705"} Verification report emailed on completion</li>
              </ul>
              <h3 className="text-sm font-semibold text-gray-700 mt-4 mb-2">What's not included</h3>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>{"\u26A0\uFE0F"} Channel reservations (Airbnb, Vrbo, Booking.com) — re-sync via channel reconnect</li>
                <li>{"\u26A0\uFE0F"} Airbnb/Vrbo reviews — tied to the channel listing, not portable</li>
                <li>{"\u26A0\uFE0F"} Task assignees — tasks are migrated unassigned; reassign after migration</li>
                <li>{"\u26A0\uFE0F"} Direct booking website — must be rebuilt in the destination account</li>
                <li>{"\u26A0\uFE0F"} Marketplace integrations — must be reconnected after migration</li>
              </ul>
            </div>

            <p className="text-sm text-gray-500 mb-6 text-center">
              Migrating {selectedCategories.length} categories: {selectedCategories.join(', ')}
            </p>

            {isDemo ? (
              <div className="space-y-3">
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 font-medium">
                  Demo account — payment bypassed
                </div>
                <button
                  onClick={handleDemoActivate}
                  disabled={loading}
                  className="w-full bg-indigo-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Starting...' : 'Start Migration (Demo)'}
                </button>
              </div>
            ) : (
              <button
                onClick={handleCheckout}
                disabled={loading}
                className="w-full bg-indigo-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Redirecting...' : `Pay ${formatPrice(grandTotal)} & Start Migration`}
              </button>
            )}
            <button
              onClick={() => setCurrentStep(1)}
              className="block mx-auto mt-4 text-sm text-gray-500 hover:text-gray-700"
            >
              Go back
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Progress ───────────────────────────────────────────── */}
      {currentStep === 3 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Migration Progress</h2>
              <p className="text-gray-500 text-sm">ID: {migrationId}</p>
            </div>
            {migrationStatus && (
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium ${
                  migrationStatus.status === 'complete'
                    ? 'bg-green-100 text-green-800'
                    : migrationStatus.status === 'failed'
                    ? 'bg-red-100 text-red-800'
                    : migrationStatus.status === 'running'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-gray-100 text-gray-800'
                }`}
              >
                {migrationStatus.status}
              </span>
            )}
          </div>

          {!migrationStatus && (
            <div className="text-center py-12">
              <div className="animate-spin w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full mx-auto mb-4" />
              <p className="text-gray-500">Waiting for migration to start...</p>
            </div>
          )}

          {migrationStatus && migrationStatus.logs && migrationStatus.logs.length > 0 && (
            <div className="mb-8">
              {migrationStatus.logs.map((log) => (
                <ProgressBar
                  key={log.category}
                  label={log.category}
                  current={log.migrated_count}
                  total={log.source_count}
                  status={log.status}
                />
              ))}
            </div>
          )}

          {migrationStatus && migrationStatus.status === 'running' && (!migrationStatus.logs || migrationStatus.logs.length === 0) && (
            <div className="text-center py-8">
              <div className="animate-spin w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full mx-auto mb-4" />
              <p className="text-gray-500">Migration in progress...</p>
            </div>
          )}

          {isTerminal && migrationStatus?.diff_report && (
            <div className="mt-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Verification Report</h3>
              <DiffReport report={migrationStatus.diff_report} />
              <button
                onClick={downloadReport}
                className="mt-4 bg-gray-100 text-gray-700 px-6 py-2 rounded-lg font-medium hover:bg-gray-200 transition-colors"
              >
                Download Report (JSON)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
