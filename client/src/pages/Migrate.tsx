import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api';
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

const ALL_CATEGORIES = ['custom_fields', 'listings', 'guests', 'owners', 'reservations', 'automations', 'tasks'];

interface Pricing {
  tier: string;
  amountCents: number;
}

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

export default function Migrate() {
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

  // Step 4: Progress
  const [migrationStatus, setMigrationStatus] = useState<MigrationStatus | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
    const interval = setInterval(async () => {
      const status = await pollStatus();
      if (status === 'complete' || status === 'complete_with_errors' || status === 'failed') {
        clearInterval(interval);
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
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post(`/migrations/${migrationId}/checkout`, {
        selectedCategories,
      });
      window.location.href = data.checkoutUrl;
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create checkout session');
    } finally {
      setLoading(false);
    }
  };

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]
    );
  };

  const formatPrice = (cents: number) => `$${(cents / 100).toFixed(0)}`;

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

      {/* Step 1: Credentials */}
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

          <button
            onClick={handlePreflight}
            disabled={loading || !sourceClientId || !sourceClientSecret || !destClientId || !destClientSecret}
            className="mt-6 bg-indigo-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Connecting...' : 'Connect & Analyze'}
          </button>
        </div>
      )}

      {/* Step 2: Manifest & Selection */}
      {currentStep === 1 && manifest && pricing && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Source Account Data</h2>
          <p className="text-gray-600 mb-6">Select the categories you want to migrate.</p>

          <ManifestCard
            manifest={manifest}
            selectedCategories={selectedCategories}
            onToggleCategory={toggleCategory}
          />

          {manifest.photos !== undefined && (
            <p className="text-sm text-gray-500 mt-1">
              📷 {manifest.photos} total photos found across all listings
            </p>
          )}

          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            ⚠️ Channel-connected listings (Airbnb, Vrbo, Booking.com) — photos will
            re-sync automatically when you reconnect channels to the destination account.
            Only native/direct listing photos will be migrated.
          </div>

          <div className="mt-8 p-4 bg-gray-50 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Migration Price</p>
              <p className="text-3xl font-bold text-gray-900">{formatPrice(pricing.amountCents)}</p>
              <p className="text-sm text-gray-500 capitalize">{pricing.tier} tier</p>
            </div>
            <button
              onClick={() => setCurrentStep(2)}
              disabled={selectedCategories.length === 0}
              className="bg-indigo-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              Continue to Payment
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Payment */}
      {currentStep === 2 && pricing && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
          <div className="max-w-md mx-auto">
            <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Ready to Migrate</h2>
            <p className="text-gray-600 mb-6">
              You'll be redirected to Stripe to complete your payment of{' '}
              <strong>{formatPrice(pricing.amountCents)}</strong>.
            </p>
            <p className="text-sm text-gray-500 mb-6">
              Migrating {selectedCategories.length} categories: {selectedCategories.join(', ')}
            </p>
            <button
              onClick={handleCheckout}
              disabled={loading}
              className="bg-indigo-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Redirecting...' : `Pay ${formatPrice(pricing.amountCents)} & Start Migration`}
            </button>
            <button
              onClick={() => setCurrentStep(1)}
              className="block mx-auto mt-4 text-sm text-gray-500 hover:text-gray-700"
            >
              Go back
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Progress */}
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
