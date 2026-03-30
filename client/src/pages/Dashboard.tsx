import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';

interface Migration {
  id: string;
  status: string;
  manifest: Record<string, number>;
  selected_categories: string[];
  results: Record<string, any> | null;
  diff_report: Record<string, any> | null;
  created_at: string;
  completed_at: string | null;
}

const statusLabel: Record<string, string> = {
  paid: 'Awaiting Migration',
  running: 'Running',
  complete: 'Complete',
  complete_with_errors: 'Complete with Errors',
  failed: 'Failed',
};

const statusStyles: Record<string, string> = {
  paid: 'bg-sky-100 text-sky-800',
  running: 'bg-amber-100 text-amber-800',
  complete: 'bg-emerald-100 text-emerald-800',
  complete_with_errors: 'bg-yellow-100 text-yellow-800',
  failed: 'bg-red-100 text-red-800',
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [migrations, setMigrations] = useState<Migration[]>([]);
  const [loading, setLoading] = useState(true);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [resendStatus, setResendStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle');
  const [resendError, setResendError] = useState('');
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const [confirmDiscardId, setConfirmDiscardId] = useState<string | null>(null);

  const handleRetry = async (migrationId: string) => {
    try {
      await api.post(`/migrations/${migrationId}/retry`);
      navigate(`/migrate?step=progress&migrationId=${migrationId}`);
    } catch (err) {
      console.error('Retry failed:', err);
    }
  };

  const handleResend = async () => {
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

  const handleDiscard = async (migrationId: string) => {
    setDiscardingId(migrationId);
    try {
      await api.delete(`/migrations/${migrationId}`);
      setMigrations((prev) => prev.filter((m) => m.id !== migrationId));
    } catch (err) {
      console.error('Discard failed:', err);
    } finally {
      setDiscardingId(null);
      setConfirmDiscardId(null);
    }
  };

  useEffect(() => {
    api
      .get('/migrations')
      .then(({ data }) => setMigrations(data.migrations))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-12 text-center">
        <div className="animate-spin w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full mx-auto" />
      </div>
    );
  }

  const pendingMigrations = migrations.filter((m) => m.status === 'pending');
  const activeMigrations = migrations.filter((m) => m.status !== 'pending');

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">

      {/* Unverified email banner */}
      {user && user.email_verified === false && !bannerDismissed && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 flex items-start gap-4">
          <div className="shrink-0 mt-0.5">
            <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900">Please verify your email address</p>
            {resendStatus === 'sent' ? (
              <p className="text-sm text-amber-700 mt-0.5">Verification email sent — check your inbox.</p>
            ) : (
              <>
                <p className="text-sm text-amber-700 mt-0.5">
                  Check <span className="font-medium">{user.email}</span> for a verification link.
                </p>
                {resendStatus === 'error' && (
                  <p className="text-sm text-red-600 mt-1">{resendError}</p>
                )}
                <button
                  onClick={handleResend}
                  disabled={resendStatus === 'loading'}
                  className="mt-2 text-sm font-semibold text-amber-700 hover:text-amber-900 underline underline-offset-2 disabled:opacity-60"
                >
                  {resendStatus === 'loading' ? 'Sending…' : 'Resend verification email'}
                </button>
              </>
            )}
          </div>
          <button
            onClick={() => setBannerDismissed(true)}
            className="shrink-0 text-amber-400 hover:text-amber-600 transition-colors"
            aria-label="Dismiss"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Dashboard</h1>
          <p className="text-slate-500 mt-1">Your migration history</p>
        </div>
        <Link
          to="/migrate"
          className="bg-amber-500 hover:bg-amber-600 text-slate-900 px-6 py-2.5 rounded-xl font-semibold shadow-sm hover:shadow-md transition-all duration-200"
        >
          New Migration
        </Link>
      </div>

      {/* Incomplete setup section */}
      {pendingMigrations.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Incomplete Setup</h2>
          <div className="space-y-3">
            {pendingMigrations.map((m) => (
              <div
                key={m.id}
                className="bg-amber-50 border border-amber-200 rounded-2xl p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-amber-900">
                      Setup started{' '}
                      {new Date(m.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {m.manifest?.listings != null && (
                        <span className="font-normal text-amber-700 ml-1">
                          &mdash; {m.manifest.listings} {m.manifest.listings === 1 ? 'listing' : 'listings'} found
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-amber-600 mt-0.5 font-mono">{m.id}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {confirmDiscardId === m.id ? (
                      <>
                        <span className="text-xs text-amber-800">Discard this setup?</span>
                        <button
                          onClick={() => handleDiscard(m.id)}
                          disabled={discardingId === m.id}
                          className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-60"
                        >
                          {discardingId === m.id ? 'Discarding…' : 'Yes, discard'}
                        </button>
                        <button
                          onClick={() => setConfirmDiscardId(null)}
                          className="text-xs text-slate-500 hover:text-slate-700"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => setConfirmDiscardId(m.id)}
                          className="text-xs text-slate-500 hover:text-red-600 transition-colors font-medium"
                        >
                          Discard
                        </button>
                        <Link
                          to={`/migrate?step=review&migrationId=${m.id}`}
                          className="bg-amber-500 hover:bg-amber-600 text-slate-900 px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors"
                        >
                          Resume Setup
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeMigrations.length === 0 && pendingMigrations.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-12 text-center">
          <div className="w-16 h-16 bg-stone-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">No migrations yet</h2>
          <p className="text-slate-500 mb-6">Start your first Guesty account migration.</p>
          <Link
            to="/migrate"
            className="inline-block bg-amber-500 hover:bg-amber-600 text-slate-900 px-6 py-2.5 rounded-xl font-semibold shadow-sm hover:shadow-md transition-all duration-200"
          >
            Start Migration
          </Link>
        </div>
      ) : activeMigrations.length === 0 ? null : (
        <div className="space-y-4">
          {activeMigrations.map((m) => (
            <div
              key={m.id}
              className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 hover:shadow-md hover:border-stone-300 transition-all duration-200"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusStyles[m.status] || 'bg-stone-100 text-slate-700'}`}>
                    {statusLabel[m.status] || m.status}
                  </span>
                  <span className="text-sm text-slate-400">
                    {new Date(m.created_at).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <div className="flex items-center">
                  {(m.status === 'failed' || m.status === 'complete_with_errors') && (
                    <button
                      onClick={() => handleRetry(m.id)}
                      className="text-sm text-amber-600 hover:text-amber-700 font-medium mr-4"
                      title="Re-run the migration. Only categories that were not previously completed will be retried. You will not be charged again."
                    >
                      Retry
                    </button>
                  )}
                  <Link
                    to={`/migrate?step=progress&migrationId=${m.id}`}
                    className="text-amber-600 hover:text-amber-700 text-sm font-medium"
                  >
                    View Details
                  </Link>
                </div>
              </div>

              <p className="text-base font-semibold text-slate-900 mb-1">
                Migration #{activeMigrations.length - activeMigrations.indexOf(m)} &mdash;{' '}
                {new Date(m.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                {m.manifest?.listings != null && (
                  <span className="text-slate-400 font-normal text-sm ml-2">
                    ({m.manifest.listings} {m.manifest.listings === 1 ? 'listing' : 'listings'})
                  </span>
                )}
              </p>
              <p className="text-xs text-slate-400 mb-3 font-mono">{m.id}</p>

              {m.manifest && (
                <div className="flex flex-wrap gap-3">
                  {Object.entries(m.manifest).map(([cat, count]) => (
                    <div key={cat} className="bg-[#fafaf8] border border-stone-200 px-3 py-1.5 rounded-xl">
                      <span className="text-xs text-slate-400 capitalize">{cat}</span>
                      <span className="ml-2 text-sm font-semibold text-slate-900">{(count as number).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}

              {m.completed_at && (
                <p className="text-xs text-slate-400 mt-3">
                  Completed: {new Date(m.completed_at).toLocaleString()}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
