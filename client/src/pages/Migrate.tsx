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

interface ListingDetail {
  id: string;
  title?: string;
  nickname?: string | null;
  type?: string | null;
  complexId?: string | null;
  city?: string | null;
  isActive?: boolean;
}

const ALL_CATEGORIES = ['custom_fields', 'fees', 'listings', 'rate_strategies', 'guests', 'owners', 'saved_replies', 'reservations', 'tasks'];

type PricingMode = 'flat_tier' | 'per_listing';
type AddOnKey = 'priority' | 'support' | 'remigrate' | 'verify' | 'pricing_snapshot';

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
  { key: 'priority',         name: 'Priority Processing',          description: 'Skip the queue — your migration runs first.',                                             priceCents: 9900  },
  { key: 'support',          name: 'Dedicated Support & Review',   description: 'A migration specialist reviews your setup and assists during the process.',                priceCents: 14900 },
  { key: 'remigrate',        name: 'Re-Migration Pass',            description: 'One free re-run within 30 days if you need to migrate again.',                            priceCents: 7900  },
  { key: 'verify',           name: 'Post-Migration Verify Call',   description: '30-minute video call to walk through your destination account.',                          priceCents: 9900  },
  { key: 'pricing_snapshot', name: 'Pricing Calendar Snapshot',    description: 'Copies 2 years of nightly prices and min-night overrides as hard calendar values.',       priceCents: 14900 },
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

function calculatePerListingCents(listingCount: number): number {
  let total = 7900;
  const t1 = Math.min(listingCount, 50);
  total += t1 * 800;
  const t2 = Math.min(Math.max(listingCount - 50, 0), 150);
  total += t2 * 500;
  const t3 = Math.max(listingCount - 200, 0);
  total += t3 * 300;
  return total;
}

const FLAT_TIERS = [
  { maxListings: 50,  amountCents: 34900, label: 'growth' },
  { maxListings: 150, amountCents: 69900, label: 'professional' },
  { maxListings: 300, amountCents: 99900, label: 'business' },
  { maxListings: 500, amountCents: 149900, label: 'enterprise' },
];

function getTierFlatCents(count: number): number {
  for (const t of FLAT_TIERS) {
    if (count <= t.maxListings) return t.amountCents;
  }
  return 0;
}

function getTierLabel(count: number): string {
  if (count <= 10) return 'per_listing';
  for (const t of FLAT_TIERS) {
    if (count <= t.maxListings) return t.label;
  }
  return 'enterprise_plus';
}

export default function Migrate() {
  const { user } = useAuth();
  const isDemo = !!user?.is_demo;
  const isBeta = !!(user as any)?.is_beta;
  const [searchParams] = useSearchParams();
  const [currentStep, setCurrentStep] = useState(0);
  const [migrationId, setMigrationId] = useState<string | null>(null);

  const [sourceClientId, setSourceClientId] = useState('');
  const [sourceClientSecret, setSourceClientSecret] = useState('');
  const [destClientId, setDestClientId] = useState('');
  const [destClientSecret, setDestClientSecret] = useState('');

  const [manifest, setManifest] = useState<Record<string, number | null> | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(ALL_CATEGORIES);
  const [pricing, setPricing] = useState<Pricing | null>(null);

  const [pricingMode, setPricingMode] = useState<PricingMode>('flat_tier');
  const [selectedAddOns, setSelectedAddOns] = useState<AddOnKey[]>([]);

  const [migrationStatus, setMigrationStatus] = useState<MigrationStatus | null>(null);

  const [pilotMode, setPilotMode] = useState(false);
  const [selectedListingIds, setSelectedListingIds] = useState<string[]>([]);
  const [allListingIds, setAllListingIds] = useState<string[]>([]);
  const [listingSearch, setListingSearch] = useState('');

  const [loading, setLoading] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [resumeError, setResumeError] = useState('');
  const [error, setError] = useState('');
  const [channelConfirmed, setChannelConfirmed] = useState(false);
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [resendStatus, setResendStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle');
  const [resendError, setResendError] = useState('');

  useEffect(() => {
    const step = searchParams.get('step');
    const id = searchParams.get('migrationId');

    if (step === 'progress' && id) {
      setMigrationId(id);
      setCurrentStep(3);
      return;
    }

    if (step === 'review' && id) {
      setResumeLoading(true);
      api
        .get(`/migrations/${id}/resume`)
        .then(({ data }) => {
          setMigrationId(data.migrationId);
          setManifest(data.manifest);
          applyManifestToCategories(data.manifest);
          setPricing(data.pricing);
          if (data.manifest?.listingDetails) {
            setAllListingIds((data.manifest.listingDetails as ListingDetail[]).map((l) => l.id));
          }
          setCurrentStep(1);
        })
        .catch(() => {
          setResumeError('That setup could not be resumed — it may have expired. Please start a new migration.');
        })
        .finally(() => setResumeLoading(false));
      return;
    }
  }, [searchParams]);

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

  const handleResendVerification = async () => {
    setResendStatus('loading');
    setResendError('');
    try {
      await api.post('/auth/resend-verification');
      setResendStatus('sent');
    } catch (err: any) {
      setResendStatus('error');
      setResendError(err.response?.data?.error || 'Failed to send email. Please try again.');
    }
  };

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
      applyManifestToCategories(data.manifest);
      setPricing(data.pricing);
      // Store listing IDs for pilot mode
      if (data.manifest?.listingDetails) {
        setAllListingIds((data.manifest.listingDetails as ListingDetail[]).map((l) => l.id));
      }
      setCurrentStep(1);
    } catch (err: any) {
      const errData = err.response?.data;
      const headline = errData?.error || 'Failed to connect to Guesty accounts';
      const detail = errData?.details;
      setError(detail ? `${headline} — ${detail}` : headline);
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
        selectedListingIds: pilotMode ? selectedListingIds : undefined,
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
      await api.post(`/migrations/${migrationId}/demo-activate`, {
        selectedCategories,
        selectedListingIds: pilotMode ? selectedListingIds : undefined,
      });
      setCurrentStep(3);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to activate demo migration');
    } finally {
      setLoading(false);
    }
  };

  const handleBetaActivate = async () => {
    if (!migrationId) return;
    setError('');
    setLoading(true);
    try {
      await api.post(`/migrations/${migrationId}/checkout`, {
        selectedCategories,
        pricingMode,
        addOns: selectedAddOns,
        selectedListingIds: pilotMode ? selectedListingIds : undefined,
      });
      setCurrentStep(3);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to activate beta migration');
    } finally {
      setLoading(false);
    }
  };

  const applyManifestToCategories = (m: Record<string, number | null>) => {
    setSelectedCategories(ALL_CATEGORIES.filter((cat) => m[cat] !== null && m[cat] !== undefined));
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

  const effectiveListingCount = pilotMode && selectedListingIds.length > 0
    ? selectedListingIds.length
    : (manifest?.listings ?? 0);
  const isPilotPricing = pilotMode && selectedListingIds.length > 0;

  const flatCents = isPilotPricing ? getTierFlatCents(effectiveListingCount) : (pricing?.amountCents || 0);
  const effectiveTier = isPilotPricing ? getTierLabel(effectiveListingCount) : (pricing?.tier || '');
  const perListingCents = calculatePerListingCents(effectiveListingCount);
  const addonTotal = selectedAddOns.reduce((sum, key) => {
    const a = ADD_ONS.find((ao) => ao.key === key);
    return sum + (a?.priceCents || 0);
  }, 0);
  const baseCents = pricingMode === 'flat_tier' ? flatCents : perListingCents;
  const grandTotal = baseCents + addonTotal;

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

  if (resumeLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <div className="animate-spin w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-slate-500 text-sm">Loading your previous setup…</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-2">New Migration</h1>
      <p className="text-slate-500 mb-8">Follow the steps below to migrate your Guesty account data.</p>

      <StepWizard steps={STEPS} currentStep={currentStep} />

      {resumeError && (
        <div className="mb-6 p-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-600 text-sm">
          {resumeError}
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
          <p>{error}</p>
          {error.toLowerCase().includes('verify your email') && (
            <div className="mt-3">
              {resendStatus === 'sent' ? (
                <p className="text-sm text-emerald-600 font-medium">Verification email sent — check your inbox.</p>
              ) : (
                <>
                  {resendStatus === 'error' && (
                    <p className="text-sm text-red-600 mb-1">{resendError}</p>
                  )}
                  <button
                    onClick={handleResendVerification}
                    disabled={resendStatus === 'loading'}
                    className="text-sm font-semibold text-red-700 hover:text-red-900 underline underline-offset-2 disabled:opacity-60"
                  >
                    {resendStatus === 'loading' ? 'Sending…' : 'Resend verification email'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Quote Modal */}
      {showQuoteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
            <h3 className="text-xl font-bold text-slate-900 mb-2">Custom Quote Required</h3>
            <p className="text-slate-500 mb-4">
              Accounts with 500+ listings require a custom migration plan. Our team will
              assess your account and provide a tailored quote within 24 hours.
            </p>
            <a
              href="mailto:support@guestymigrate.com?subject=Enterprise%20Migration%20Quote&body=I%20have%20500%2B%20listings%20and%20need%20a%20custom%20migration%20quote."
              className="block w-full text-center bg-amber-500 hover:bg-amber-600 text-slate-900 px-6 py-3 rounded-xl font-semibold transition-all duration-200 mb-3"
            >
              Contact Us for a Quote
            </a>
            <button
              onClick={() => setShowQuoteModal(false)}
              className="block w-full text-center text-slate-400 hover:text-slate-600 text-sm"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Credentials */}
      {currentStep === 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8">
          <h2 className="text-xl font-bold text-slate-900 mb-6">Enter API Credentials</h2>

          <div className="space-y-6">
            <div className="bg-sky-50 border border-sky-200 rounded-xl p-5">
              <h3 className="font-bold text-sky-900 mb-3">Source Account (migrate FROM)</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Client ID</label>
                  <input
                    type="text"
                    value={sourceClientId}
                    onChange={(e) => setSourceClientId(e.target.value)}
                    className="w-full px-4 py-3 border border-stone-300 rounded-xl bg-white text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 outline-none transition-colors"
                    placeholder="Source Client ID"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Client Secret</label>
                  <input
                    type="password"
                    value={sourceClientSecret}
                    onChange={(e) => setSourceClientSecret(e.target.value)}
                    className="w-full px-4 py-3 border border-stone-300 rounded-xl bg-white text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 outline-none transition-colors"
                    placeholder="Source Client Secret"
                  />
                </div>
              </div>
            </div>

            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
              <h3 className="font-bold text-emerald-900 mb-3">Destination Account (migrate TO)</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Client ID</label>
                  <input
                    type="text"
                    value={destClientId}
                    onChange={(e) => setDestClientId(e.target.value)}
                    className="w-full px-4 py-3 border border-stone-300 rounded-xl bg-white text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 outline-none transition-colors"
                    placeholder="Destination Client ID"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Client Secret</label>
                  <input
                    type="password"
                    value={destClientSecret}
                    onChange={(e) => setDestClientSecret(e.target.value)}
                    className="w-full px-4 py-3 border border-stone-300 rounded-xl bg-white text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 outline-none transition-colors"
                    placeholder="Destination Client Secret"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 p-5 bg-amber-50 border border-amber-200 rounded-xl">
            <h3 className="font-bold text-amber-900 mb-3">Before you begin</h3>
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
                className="w-4 h-4 text-amber-500 rounded border-stone-300 focus:ring-amber-500/30"
              />
              <span className="text-sm text-amber-900 font-medium">
                I have disconnected all channels (Airbnb, Vrbo, Booking.com) from
                the source Guesty account
              </span>
            </label>
          </div>

          {loading && (
            <div className="mt-6 flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <div className="animate-spin w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-900">Connecting to your Guesty accounts…</p>
                <p className="text-xs text-amber-700 mt-0.5">Fetching account data — this can take up to 30 seconds.</p>
              </div>
            </div>
          )}

          <button
            onClick={handlePreflight}
            disabled={loading || !sourceClientId || !sourceClientSecret || !destClientId || !destClientSecret || !channelConfirmed}
            className="mt-4 bg-amber-500 hover:bg-amber-600 text-slate-900 px-8 py-3 rounded-xl font-semibold shadow-sm hover:shadow-md disabled:opacity-50 transition-all duration-200"
          >
            {loading ? 'Connecting...' : 'Connect & Analyze'}
          </button>
        </div>
      )}

      {/* Step 2: Manifest & Selection */}
      {currentStep === 1 && manifest && pricing && (
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8">
          <h2 className="text-xl font-bold text-slate-900 mb-2">Source Account Data</h2>
          <p className="text-slate-500 mb-6">Select the categories you want to migrate.</p>

          <ManifestCard
            manifest={Object.fromEntries(
              Object.entries(manifest).filter(([k]) => !['photos', 'listingDetails', 'pricing_snapshot_available'].includes(k))
            )}
            selectedCategories={selectedCategories}
            onToggleCategory={toggleCategory}
          />

          {manifest.photos !== undefined && (
            <div className="mt-4 p-4 bg-sky-50 border border-sky-200 rounded-xl flex items-center gap-3">
              <svg className="w-6 h-6 text-sky-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-sm text-sky-800">
                <strong>{(manifest.photos ?? 0).toLocaleString()} photos</strong> found across
                all listings — native listing photos will be migrated automatically
                when Listings is selected. Channel-connected listing photos re-sync
                when you reconnect channels. Calendar blocks are also transferred
                per listing.
              </p>
            </div>
          )}

          <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
            <strong>Before running:</strong> Disconnect all channels (Airbnb, Vrbo,
            Booking.com) from the source account. Channel reservations cannot be
            migrated and will be skipped automatically.
          </div>

          {/* Pilot Mode Listing Picker */}
          {(manifest.listings ?? 0) > 0 && selectedCategories.includes('listings') && (() => {
            const allDetails = ((manifest as Record<string, unknown>).listingDetails as ListingDetail[] | undefined) ?? [];
            const q = listingSearch.toLowerCase().trim();
            const filteredDetails = q
              ? allDetails.filter(l =>
                  (l.title ?? '').toLowerCase().includes(q) ||
                  (l.nickname ?? '').toLowerCase().includes(q) ||
                  (l.city ?? '').toLowerCase().includes(q) ||
                  (l.type ?? '').toLowerCase().includes(q) ||
                  l.id.toLowerCase().includes(q)
                )
              : allDetails;
            const filteredIds = filteredDetails.map(l => l.id);
            const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => selectedListingIds.includes(id));

            const typeBadge = (l: ListingDetail) => {
              if (l.type === 'MTL') return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 flex-shrink-0">Multi-Unit</span>;
              if (l.complexId)      return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 flex-shrink-0">Complex Unit</span>;
              if (l.type === 'ROOM') return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 flex-shrink-0">Room</span>;
              return null;
            };

            return (
              <div className="mt-6 p-5 bg-white border border-stone-200 rounded-xl">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-slate-900">Listing Selection</h3>
                    <p className="text-sm text-slate-400">Choose which listings to migrate</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setPilotMode(false); setSelectedListingIds([]); setListingSearch(''); }}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                        !pilotMode ? 'bg-amber-500 text-slate-900' : 'bg-stone-100 text-slate-600 hover:bg-stone-200'
                      }`}
                    >
                      Migrate All
                    </button>
                    <button
                      onClick={() => { setPilotMode(true); }}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                        pilotMode ? 'bg-amber-500 text-slate-900' : 'bg-stone-100 text-slate-600 hover:bg-stone-200'
                      }`}
                    >
                      Pilot Mode
                    </button>
                  </div>
                </div>

                {pilotMode && (
                  <div>
                    <p className="text-sm text-slate-500 mb-3">
                      Select specific listings to migrate. Reservations, tasks, and saved replies will be scoped to the selected listings only.
                    </p>

                    {/* Search box */}
                    <div className="relative mb-3">
                      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                      </svg>
                      <input
                        type="text"
                        value={listingSearch}
                        onChange={e => setListingSearch(e.target.value)}
                        placeholder="Search by name, city, type, or ID…"
                        className="w-full pl-9 pr-9 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/50 bg-[#fafaf8]"
                      />
                      {listingSearch && (
                        <button
                          onClick={() => setListingSearch('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                          aria-label="Clear search"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>

                    {/* Toolbar */}
                    <div className="flex items-center gap-2 mb-2">
                      <button
                        onClick={() => {
                          if (allFilteredSelected) {
                            setSelectedListingIds(prev => prev.filter(id => !filteredIds.includes(id)));
                          } else {
                            setSelectedListingIds(prev => Array.from(new Set([...prev, ...filteredIds])));
                          }
                        }}
                        className="text-xs text-amber-600 hover:text-amber-700 font-medium"
                      >
                        {allFilteredSelected
                          ? (q ? 'Deselect filtered' : 'Deselect all')
                          : (q ? `Select all ${filteredDetails.length} filtered` : 'Select all')}
                      </button>
                      <span className="text-xs text-slate-300">|</span>
                      <button
                        onClick={() => setSelectedListingIds([])}
                        className="text-xs text-amber-600 hover:text-amber-700 font-medium"
                      >
                        Clear all
                      </button>
                      <span className="text-xs text-slate-400 ml-auto">
                        {selectedListingIds.length} of {allListingIds.length} selected
                        {q && filteredDetails.length !== allDetails.length && (
                          <span className="text-slate-300"> · {filteredDetails.length} shown</span>
                        )}
                      </span>
                    </div>

                    {/* Listing list */}
                    <div className="max-h-72 overflow-y-auto border border-stone-100 rounded-lg">
                      {filteredDetails.length === 0 ? (
                        <p className="text-sm text-slate-400 text-center py-6">No listings match your search.</p>
                      ) : (
                        filteredDetails.map((listing) => (
                          <label
                            key={listing.id}
                            className={`flex items-center gap-3 px-3 py-2.5 hover:bg-stone-50 cursor-pointer border-b border-stone-50 last:border-0 ${
                              listing.isActive === false ? 'opacity-60' : ''
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedListingIds.includes(listing.id)}
                              onChange={() => {
                                setSelectedListingIds(prev =>
                                  prev.includes(listing.id)
                                    ? prev.filter(id => id !== listing.id)
                                    : [...prev, listing.id]
                                );
                              }}
                              className="w-4 h-4 text-amber-500 rounded border-stone-300 focus:ring-amber-500/30 flex-shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-sm text-slate-700 truncate">{listing.title}</span>
                                {typeBadge(listing)}
                                {listing.isActive === false && (
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 flex-shrink-0">Inactive</span>
                                )}
                              </div>
                              {(listing.nickname && listing.nickname !== listing.title) || listing.city ? (
                                <p className="text-xs text-slate-400 truncate mt-0.5">
                                  {[listing.nickname !== listing.title ? listing.nickname : null, listing.city].filter(Boolean).join(' · ')}
                                </p>
                              ) : null}
                            </div>
                            <span className="text-xs text-slate-400 flex-shrink-0 font-mono">{listing.id.slice(-8)}</span>
                          </label>
                        ))
                      )}
                    </div>

                    {selectedListingIds.length === 0 && (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
                        Select at least one listing to continue in pilot mode.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          <div className="mt-8 p-5 bg-[#fafaf8] border border-stone-200 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Migration Price</p>
              {(isBeta || isDemo) ? (
                <>
                  <p className="text-2xl font-bold text-slate-900">No charge</p>
                  <p className="text-sm text-slate-400">{isBeta ? 'Beta account' : 'Demo account'} — payment bypassed</p>
                </>
              ) : pricing.requiresQuote ? (
                <>
                  <p className="text-2xl font-bold text-slate-900">Custom Quote</p>
                  <p className="text-sm text-slate-400">500+ listings</p>
                </>
              ) : (
                <>
                  <p className="text-3xl font-extrabold text-slate-900">from {formatPrice(Math.min(flatCents, perListingCents))}</p>
                  <p className="text-sm text-slate-400 capitalize">{effectiveTier} tier{isPilotPricing ? ` · ${effectiveListingCount} pilot listings` : ''}</p>
                </>
              )}
            </div>
            {(!isBeta && !isDemo) && pricing.requiresQuote ? (
              <button
                onClick={() => setShowQuoteModal(true)}
                className="bg-amber-500 hover:bg-amber-600 text-slate-900 px-8 py-3 rounded-xl font-semibold shadow-sm hover:shadow-md transition-all duration-200"
              >
                Contact Us for a Quote
              </button>
            ) : (
              <button
                onClick={() => setCurrentStep(2)}
                disabled={selectedCategories.length === 0 || (pilotMode && selectedListingIds.length === 0)}
                className="bg-amber-500 hover:bg-amber-600 text-slate-900 px-8 py-3 rounded-xl font-semibold shadow-sm hover:shadow-md disabled:opacity-50 transition-all duration-200"
              >
                Continue to Payment
              </button>
            )}
          </div>
        </div>
      )}

      {/* Step 3: Payment */}
      {currentStep === 2 && pricing && (!pricing.requiresQuote || isBeta || isDemo) && manifest && (
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8">
          <div className="max-w-2xl mx-auto">
            <div className="w-16 h-16 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            </div>
            {(isBeta || isDemo) ? (
              /* ── Beta / Demo: payment-free confirmation ── */
              <>
                <h2 className="text-xl font-bold text-slate-900 mb-2 text-center">Confirm Migration</h2>
                <div className={`mb-6 flex items-center gap-3 px-4 py-4 ${isBeta ? 'bg-purple-50 border-purple-200' : 'bg-amber-50 border-amber-200'} border rounded-xl`}>
                  <svg className={`w-5 h-5 flex-shrink-0 ${isBeta ? 'text-purple-500' : 'text-amber-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <div>
                    <p className={`text-sm font-bold ${isBeta ? 'text-purple-900' : 'text-amber-900'}`}>
                      {isBeta ? 'Beta account — no payment required' : 'Demo account — no payment required'}
                    </p>
                    <p className={`text-xs mt-0.5 ${isBeta ? 'text-purple-700' : 'text-amber-700'}`}>
                      All features are available to you at no charge. Your migration will start immediately.
                    </p>
                  </div>
                </div>

                {isPilotPricing && (
                  <div className="mb-6 flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 font-medium">
                    <svg className="w-4 h-4 flex-shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Pilot mode — migrating {effectiveListingCount} selected listing{effectiveListingCount === 1 ? '' : 's'}.
                  </div>
                )}

                {/* Add-ons for beta/demo (no prices shown — all included) */}
                <div className="mb-6">
                  <h3 className="text-sm font-bold text-slate-700 mb-3">Optional features</h3>
                  <div className="space-y-2">
                    {ADD_ONS.map((addon) => (
                      <label
                        key={addon.key}
                        className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-200 ${
                          selectedAddOns.includes(addon.key)
                            ? 'border-amber-400 bg-amber-50'
                            : 'border-stone-200 hover:border-stone-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedAddOns.includes(addon.key)}
                          onChange={() => toggleAddOn(addon.key)}
                          className="mt-0.5 w-4 h-4 text-amber-500 rounded border-stone-300 focus:ring-amber-500/30 flex-shrink-0"
                        />
                        <div className="flex-1">
                          <span className="text-sm font-semibold text-slate-900">{addon.name}</span>
                          <p className="text-xs text-slate-400 mt-0.5">{addon.description}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <p className="text-sm text-slate-400 mb-6 text-center">
                  Migrating {selectedCategories.length} categories: {selectedCategories.join(', ')}
                </p>

                <button
                  onClick={isBeta ? handleBetaActivate : handleDemoActivate}
                  disabled={loading}
                  className="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 px-8 py-3 rounded-xl font-semibold shadow-sm hover:shadow-md disabled:opacity-50 transition-all duration-200"
                >
                  {loading ? 'Starting...' : 'Start Migration'}
                </button>
              </>
            ) : (
              /* ── Regular paying users ── */
              <>
                <h2 className="text-xl font-bold text-slate-900 mb-2 text-center">Choose Your Pricing</h2>
                <p className="text-slate-500 mb-4 text-center">
                  Select a pricing mode and any optional add-ons for your migration.
                </p>
                {isPilotPricing && (
                  <div className="mb-6 flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 font-medium">
                    <svg className="w-4 h-4 flex-shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Pilot mode — pricing is based on your {effectiveListingCount} selected listing{effectiveListingCount === 1 ? '' : 's'}, not the full account.
                  </div>
                )}

                {/* Pricing Mode Toggle */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                  <button
                    onClick={() => setPricingMode('flat_tier')}
                    className={`relative p-5 rounded-xl border-2 text-left transition-all duration-200 ${
                      pricingMode === 'flat_tier'
                        ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-500'
                        : 'border-stone-200 hover:border-stone-300'
                    }`}
                  >
                    {flatIsBetter && (
                      <span className="absolute -top-2.5 left-4 bg-emerald-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                        Best value
                      </span>
                    )}
                    <div className="flex items-center gap-3 mb-2">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        pricingMode === 'flat_tier' ? 'border-amber-500' : 'border-stone-300'
                      }`}>
                        {pricingMode === 'flat_tier' && <div className="w-2 h-2 rounded-full bg-amber-500" />}
                      </div>
                      <span className="font-bold text-slate-900">Flat Rate</span>
                    </div>
                    <p className="text-2xl font-extrabold text-slate-900 ml-7">{formatPrice(flatCents)}</p>
                    <p className="text-sm text-slate-400 ml-7 capitalize">{effectiveTier} tier — {effectiveListingCount} {isPilotPricing ? 'pilot ' : ''}listings</p>
                  </button>

                  <button
                    onClick={() => setPricingMode('per_listing')}
                    className={`relative p-5 rounded-xl border-2 text-left transition-all duration-200 ${
                      pricingMode === 'per_listing'
                        ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-500'
                        : 'border-stone-200 hover:border-stone-300'
                    }`}
                  >
                    {!flatIsBetter && (
                      <span className="absolute -top-2.5 left-4 bg-emerald-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                        Best value
                      </span>
                    )}
                    <div className="flex items-center gap-3 mb-2">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        pricingMode === 'per_listing' ? 'border-amber-500' : 'border-stone-300'
                      }`}>
                        {pricingMode === 'per_listing' && <div className="w-2 h-2 rounded-full bg-amber-500" />}
                      </div>
                      <span className="font-bold text-slate-900">Per Listing</span>
                    </div>
                    <p className="text-2xl font-extrabold text-slate-900 ml-7">{formatPrice(perListingCents)}</p>
                    <p className="text-sm text-slate-400 ml-7">$79 base + graduated per-listing rate</p>
                  </button>
                </div>

                {/* Per-listing breakdown */}
                {pricingMode === 'per_listing' && (
                  <div className="mb-8 p-5 bg-[#fafaf8] border border-stone-200 rounded-xl text-sm">
                    <h4 className="font-bold text-slate-700 mb-2">Rate Breakdown</h4>
                    <table className="w-full text-left">
                      <tbody className="text-slate-600">
                        <tr><td className="py-0.5">Base fee</td><td className="text-right font-medium">$79.00</td></tr>
                        {effectiveListingCount > 0 && (
                          <tr>
                            <td className="py-0.5">Listings 1–{Math.min(effectiveListingCount, 50)} @ $8.00</td>
                            <td className="text-right font-medium">${(Math.min(effectiveListingCount, 50) * 8).toFixed(2)}</td>
                          </tr>
                        )}
                        {effectiveListingCount > 50 && (
                          <tr>
                            <td className="py-0.5">Listings 51–{Math.min(effectiveListingCount, 200)} @ $5.00</td>
                            <td className="text-right font-medium">${(Math.min(Math.max(effectiveListingCount - 50, 0), 150) * 5).toFixed(2)}</td>
                          </tr>
                        )}
                        {effectiveListingCount > 200 && (
                          <tr>
                            <td className="py-0.5">Listings 201–{effectiveListingCount} @ $3.00</td>
                            <td className="text-right font-medium">${(Math.max(effectiveListingCount - 200, 0) * 3).toFixed(2)}</td>
                          </tr>
                        )}
                        <tr className="border-t border-stone-200">
                          <td className="pt-2 font-bold text-slate-900">Total</td>
                          <td className="pt-2 text-right font-extrabold text-slate-900">{formatPrice(perListingCents)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Add-ons */}
                <div className="mb-8">
                  <h3 className="text-lg font-bold text-slate-900 mb-4">Optional Add-ons</h3>
                  <div className="space-y-3">
                    {ADD_ONS.map((addon) => (
                      <label
                        key={addon.key}
                        className={`flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 ${
                          selectedAddOns.includes(addon.key)
                            ? 'border-amber-500 bg-amber-50'
                            : 'border-stone-200 hover:border-stone-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedAddOns.includes(addon.key)}
                          onChange={() => toggleAddOn(addon.key)}
                          className="mt-1 w-4 h-4 text-amber-500 rounded border-stone-300 focus:ring-amber-500/30"
                        />
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-900">{addon.name}</span>
                            <span className="font-extrabold text-slate-900">{formatPrice(addon.priceCents)}</span>
                          </div>
                          <p className="text-sm text-slate-400 mt-0.5">{addon.description}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Order Summary */}
                <div className="p-5 bg-[#fafaf8] border border-stone-200 rounded-xl mb-6">
                  <h3 className="text-sm font-bold text-slate-700 mb-3">Order Summary</h3>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500">
                        {pricingMode === 'flat_tier' ? `${effectiveTier} flat rate` : `Per-listing (${effectiveListingCount} ${isPilotPricing ? 'pilot ' : ''}listings)`}
                      </span>
                      <span className="font-medium text-slate-900">{formatPrice(baseCents)}</span>
                    </div>
                    {selectedAddOns.map((key) => {
                      const a = ADD_ONS.find((ao) => ao.key === key);
                      return a ? (
                        <div key={key} className="flex justify-between">
                          <span className="text-slate-500">{a.name}</span>
                          <span className="font-medium text-slate-900">{formatPrice(a.priceCents)}</span>
                        </div>
                      ) : null;
                    })}
                    <div className="flex justify-between pt-2 border-t border-stone-200">
                      <span className="font-bold text-slate-900">Total</span>
                      <span className="font-extrabold text-lg text-slate-900">{formatPrice(grandTotal)}</span>
                    </div>
                  </div>
                </div>

                {/* What's included */}
                <div className="p-5 bg-[#fafaf8] border border-stone-200 rounded-xl text-left mb-6">
                  <h3 className="text-sm font-bold text-slate-700 mb-2">What's included</h3>
                  <ul className="text-sm text-slate-500 space-y-1">
                    <li className="flex items-center gap-2"><svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg> Listings (including complex/MTL hierarchies), guests, owners, reservations (direct only)</li>
                    <li className="flex items-center gap-2"><svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg> Saved replies with listing ID remapping</li>
                    <li className="flex items-center gap-2"><svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg> Tasks with listing and assignee remapping</li>
                    <li className="flex items-center gap-2"><svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg> Custom fields and account-level fees</li>
                    <li className="flex items-center gap-2"><svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg> Native listing photos and calendar blocks</li>
                    <li className="flex items-center gap-2"><svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg> Verification report emailed on completion</li>
                  </ul>
                  <h3 className="text-sm font-bold text-slate-700 mt-4 mb-2">What's not included</h3>
                  <ul className="text-sm text-slate-500 space-y-1">
                    <li className="flex items-center gap-2"><svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg> Channel reservations — re-sync via channel reconnect</li>
                    <li className="flex items-center gap-2"><svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg> Airbnb/Vrbo reviews — tied to the channel listing</li>
                    <li className="flex items-center gap-2"><svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg> Task assignees — tasks migrate unassigned</li>
                  </ul>
                </div>

                <p className="text-sm text-slate-400 mb-6 text-center">
                  Migrating {selectedCategories.length} categories: {selectedCategories.join(', ')}
                </p>

                <button
                  onClick={handleCheckout}
                  disabled={loading}
                  className="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 px-8 py-3 rounded-xl font-semibold shadow-sm hover:shadow-md disabled:opacity-50 transition-all duration-200"
                >
                  {loading ? 'Redirecting...' : `Pay ${formatPrice(grandTotal)} & Start Migration`}
                </button>
              </>
            )}
            <button
              onClick={() => setCurrentStep(1)}
              className="block mx-auto mt-4 text-sm text-slate-400 hover:text-slate-600"
            >
              Go back
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Progress */}
      {currentStep === 3 && (
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Migration Progress</h2>
              <p className="text-slate-400 text-sm font-mono">{migrationId}</p>
            </div>
            {migrationStatus && (
              <span
                className={`px-3 py-1 rounded-full text-sm font-semibold ${
                  migrationStatus.status === 'complete'
                    ? 'bg-emerald-100 text-emerald-800'
                    : migrationStatus.status === 'failed'
                    ? 'bg-red-100 text-red-800'
                    : migrationStatus.status === 'running'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-stone-100 text-slate-700'
                }`}
              >
                {migrationStatus.status}
              </span>
            )}
          </div>

          {!migrationStatus && (
            <div className="text-center py-12">
              <div className="animate-spin w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full mx-auto mb-4" />
              <p className="text-slate-400">Waiting for migration to start...</p>
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
              <div className="animate-spin w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full mx-auto mb-4" />
              <p className="text-slate-400">Migration in progress...</p>
            </div>
          )}

          {isTerminal && migrationStatus?.diff_report && (
            <div className="mt-6">
              <h3 className="text-lg font-bold text-slate-900 mb-4">Verification Report</h3>
              <DiffReport report={migrationStatus.diff_report} />
              <button
                onClick={downloadReport}
                className="mt-4 bg-stone-100 text-slate-700 px-6 py-2.5 rounded-xl font-semibold hover:bg-stone-200 transition-all duration-200"
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
