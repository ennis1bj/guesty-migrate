import { useState, useEffect } from 'react';
import api from '../api';

interface BetaInvoice {
  id: string;
  stripe_invoice_id: string;
  description: string;
  amount_cents: number;
  due_date: string | null;
  status: string;
  created_at: string;
}

interface BetaParticipant {
  id: string;
  email: string;
  is_beta: boolean;
  beta_starts_at: string | null;
  beta_expires_at: string | null;
  beta_notes: string | null;
  beta_status: 'active' | 'expired' | 'inactive';
  invoices: BetaInvoice[];
}

interface SearchUser {
  id: string;
  email: string;
  is_beta: boolean;
  beta_expires_at: string | null;
  is_admin: boolean;
  created_at: string;
}

const statusStyles: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  expired: 'bg-red-100 text-red-800',
  inactive: 'bg-stone-100 text-slate-600',
};

const invoiceStatusStyles: Record<string, string> = {
  draft: 'bg-stone-100 text-slate-600',
  open: 'bg-sky-100 text-sky-800',
  paid: 'bg-emerald-100 text-emerald-800',
  void: 'bg-red-100 text-red-800',
  uncollectible: 'bg-red-100 text-red-800',
};

export default function Admin() {
  const [participants, setParticipants] = useState<BetaParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Grant form
  const [grantEmail, setGrantEmail] = useState('');
  const [grantStartsAt, setGrantStartsAt] = useState('');
  const [grantExpiresAt, setGrantExpiresAt] = useState('');
  const [grantNotes, setGrantNotes] = useState('');
  const [granting, setGranting] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [searching, setSearching] = useState(false);

  // Extend form
  const [extendUserId, setExtendUserId] = useState<string | null>(null);
  const [extendDate, setExtendDate] = useState('');

  // Invoice form
  const [invoiceUserId, setInvoiceUserId] = useState<string | null>(null);
  const [invoiceDesc, setInvoiceDesc] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [invoiceDueDate, setInvoiceDueDate] = useState('');
  const [creatingInvoice, setCreatingInvoice] = useState(false);

  const fetchParticipants = async () => {
    try {
      const { data } = await api.get('/admin/beta');
      setParticipants(data.participants);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load beta participants');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchParticipants();
  }, []);

  const handleSearch = async () => {
    if (searchQuery.length < 2) return;
    setSearching(true);
    try {
      const { data } = await api.get(`/admin/users/search?q=${encodeURIComponent(searchQuery)}`);
      setSearchResults(data.users);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleGrant = async () => {
    if (!grantEmail || !grantExpiresAt) {
      setError('Email and expiration date are required');
      return;
    }
    setGranting(true);
    setError('');
    try {
      await api.post('/admin/beta/grant', {
        email: grantEmail,
        startsAt: grantStartsAt || undefined,
        expiresAt: grantExpiresAt,
        notes: grantNotes || undefined,
      });
      setSuccess(`Beta access granted to ${grantEmail}`);
      setGrantEmail('');
      setGrantStartsAt('');
      setGrantExpiresAt('');
      setGrantNotes('');
      fetchParticipants();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to grant beta access');
    } finally {
      setGranting(false);
    }
  };

  const handleExtend = async (userId: string) => {
    if (!extendDate) return;
    setError('');
    try {
      await api.post(`/admin/beta/${userId}/extend`, { expiresAt: extendDate });
      setSuccess('Beta access extended');
      setExtendUserId(null);
      setExtendDate('');
      fetchParticipants();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to extend beta access');
    }
  };

  const handleRevoke = async (userId: string) => {
    setError('');
    try {
      await api.post(`/admin/beta/${userId}/revoke`);
      setSuccess('Beta access revoked');
      fetchParticipants();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to revoke beta access');
    }
  };

  const handleCreateInvoice = async (userId: string) => {
    if (!invoiceDesc || !invoiceAmount) {
      setError('Description and amount are required');
      return;
    }
    setCreatingInvoice(true);
    setError('');
    try {
      const { data } = await api.post(`/admin/beta/${userId}/invoice`, {
        description: invoiceDesc,
        amountCents: Math.round(parseFloat(invoiceAmount) * 100),
        dueDate: invoiceDueDate || undefined,
      });
      setSuccess(`Invoice created and sent (${data.invoiceId})`);
      setInvoiceUserId(null);
      setInvoiceDesc('');
      setInvoiceAmount('');
      setInvoiceDueDate('');
      fetchParticipants();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create invoice');
    } finally {
      setCreatingInvoice(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-12 text-center">
        <div className="animate-spin w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full mx-auto" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Beta Access Manager</h1>
        <p className="text-slate-500 mt-1">Grant, manage, and invoice beta participants</p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 text-sm">Dismiss</button>
        </div>
      )}

      {success && (
        <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 flex items-center justify-between">
          <span>{success}</span>
          <button onClick={() => setSuccess('')} className="text-emerald-400 hover:text-emerald-600 text-sm">Dismiss</button>
        </div>
      )}

      {/* User Search */}
      <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 mb-6">
        <h2 className="text-lg font-bold text-slate-900 mb-4">Search Users</h2>
        <div className="flex gap-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search by email..."
            className="flex-1 px-4 py-2.5 border border-stone-300 rounded-xl bg-white text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500 outline-none transition-colors"
          />
          <button
            onClick={handleSearch}
            disabled={searching || searchQuery.length < 2}
            className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-2.5 rounded-xl font-semibold disabled:opacity-50 transition-all"
          >
            {searching ? 'Searching...' : 'Search'}
          </button>
        </div>
        {searchResults.length > 0 && (
          <div className="mt-4 space-y-2">
            {searchResults.map((u) => (
              <div key={u.id} className="flex items-center justify-between p-3 bg-[#fafaf8] rounded-xl">
                <div>
                  <span className="text-sm font-medium text-slate-900">{u.email}</span>
                  <span className="text-xs text-slate-400 ml-2">Joined {formatDate(u.created_at)}</span>
                  {u.is_beta && <span className="ml-2 bg-purple-100 text-purple-800 text-xs font-bold px-2 py-0.5 rounded-full">BETA</span>}
                  {u.is_admin && <span className="ml-2 bg-slate-200 text-slate-700 text-xs font-bold px-2 py-0.5 rounded-full">ADMIN</span>}
                </div>
                <button
                  onClick={() => { setGrantEmail(u.email); setSearchResults([]); setSearchQuery(''); }}
                  className="text-sm text-purple-600 hover:text-purple-700 font-medium"
                >
                  Grant Beta
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Grant Beta Access */}
      <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 mb-6">
        <h2 className="text-lg font-bold text-slate-900 mb-4">Grant Beta Access</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">User Email</label>
            <input
              type="email"
              value={grantEmail}
              onChange={(e) => setGrantEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full px-4 py-2.5 border border-stone-300 rounded-xl bg-white text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500 outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Start Date (optional)</label>
            <input
              type="date"
              value={grantStartsAt}
              onChange={(e) => setGrantStartsAt(e.target.value)}
              className="w-full px-4 py-2.5 border border-stone-300 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500 outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Expiration Date</label>
            <input
              type="date"
              value={grantExpiresAt}
              onChange={(e) => setGrantExpiresAt(e.target.value)}
              className="w-full px-4 py-2.5 border border-stone-300 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500 outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Notes (optional)</label>
            <input
              type="text"
              value={grantNotes}
              onChange={(e) => setGrantNotes(e.target.value)}
              placeholder="Internal notes about this engagement"
              className="w-full px-4 py-2.5 border border-stone-300 rounded-xl bg-white text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500 outline-none transition-colors"
            />
          </div>
        </div>
        <button
          onClick={handleGrant}
          disabled={granting || !grantEmail || !grantExpiresAt}
          className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2.5 rounded-xl font-semibold disabled:opacity-50 transition-all shadow-sm hover:shadow-md"
        >
          {granting ? 'Granting...' : 'Grant Beta Access'}
        </button>
      </div>

      {/* Beta Participants List */}
      <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6">
        <h2 className="text-lg font-bold text-slate-900 mb-4">
          Beta Participants
          <span className="ml-2 text-sm font-normal text-slate-400">({participants.length})</span>
        </h2>

        {participants.length === 0 ? (
          <p className="text-slate-400 text-center py-8">No beta participants yet</p>
        ) : (
          <div className="space-y-4">
            {participants.map((p) => (
              <div key={p.id} className="border border-stone-200 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-slate-900">{p.email}</span>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${statusStyles[p.beta_status] || statusStyles.inactive}`}>
                      {p.beta_status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.beta_status === 'active' && (
                      <>
                        <button
                          onClick={() => setExtendUserId(extendUserId === p.id ? null : p.id)}
                          className="text-sm text-amber-600 hover:text-amber-700 font-medium"
                        >
                          Extend
                        </button>
                        <button
                          onClick={() => handleRevoke(p.id)}
                          className="text-sm text-red-500 hover:text-red-600 font-medium"
                        >
                          Revoke
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => setInvoiceUserId(invoiceUserId === p.id ? null : p.id)}
                      className="text-sm text-purple-600 hover:text-purple-700 font-medium"
                    >
                      {invoiceUserId === p.id ? 'Cancel' : 'Invoice'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
                  <div>
                    <span className="text-slate-400">Start</span>
                    <p className="font-medium text-slate-700">{formatDate(p.beta_starts_at)}</p>
                  </div>
                  <div>
                    <span className="text-slate-400">Expires</span>
                    <p className="font-medium text-slate-700">{formatDate(p.beta_expires_at)}</p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-400">Notes</span>
                    <p className="font-medium text-slate-700">{p.beta_notes || '—'}</p>
                  </div>
                </div>

                {/* Extend form */}
                {extendUserId === p.id && (
                  <div className="mt-3 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-end gap-3">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-amber-900 mb-1">New Expiration Date</label>
                      <input
                        type="date"
                        value={extendDate}
                        onChange={(e) => setExtendDate(e.target.value)}
                        className="w-full px-3 py-2 border border-amber-300 rounded-lg bg-white text-slate-900 focus:ring-2 focus:ring-amber-500/30 outline-none"
                      />
                    </div>
                    <button
                      onClick={() => handleExtend(p.id)}
                      disabled={!extendDate}
                      className="bg-amber-500 hover:bg-amber-600 text-slate-900 px-5 py-2 rounded-lg font-semibold disabled:opacity-50 transition-all"
                    >
                      Extend
                    </button>
                  </div>
                )}

                {/* Invoice form */}
                {invoiceUserId === p.id && (
                  <div className="mt-3 p-4 bg-purple-50 border border-purple-200 rounded-xl">
                    <h4 className="text-sm font-bold text-purple-900 mb-3">Create Custom Invoice</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                      <div className="md:col-span-2">
                        <input
                          type="text"
                          value={invoiceDesc}
                          onChange={(e) => setInvoiceDesc(e.target.value)}
                          placeholder="e.g. GuestyMigrate Beta Program — Q1 2026"
                          className="w-full px-3 py-2 border border-purple-300 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-purple-500/30 outline-none"
                        />
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={invoiceAmount}
                          onChange={(e) => setInvoiceAmount(e.target.value)}
                          placeholder="Amount ($)"
                          className="flex-1 px-3 py-2 border border-purple-300 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-purple-500/30 outline-none"
                        />
                      </div>
                    </div>
                    <div className="flex items-end gap-3">
                      <div>
                        <label className="block text-xs text-purple-700 mb-1">Due Date (optional)</label>
                        <input
                          type="date"
                          value={invoiceDueDate}
                          onChange={(e) => setInvoiceDueDate(e.target.value)}
                          className="px-3 py-2 border border-purple-300 rounded-lg bg-white text-slate-900 focus:ring-2 focus:ring-purple-500/30 outline-none"
                        />
                      </div>
                      <button
                        onClick={() => handleCreateInvoice(p.id)}
                        disabled={creatingInvoice || !invoiceDesc || !invoiceAmount}
                        className="bg-purple-600 hover:bg-purple-700 text-white px-5 py-2 rounded-lg font-semibold disabled:opacity-50 transition-all"
                      >
                        {creatingInvoice ? 'Creating...' : 'Send Invoice'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Existing invoices */}
                {p.invoices && p.invoices.length > 0 && (
                  <div className="mt-3">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Invoices</h4>
                    <div className="space-y-1.5">
                      {p.invoices.map((inv) => (
                        <div key={inv.id} className="flex items-center justify-between p-2.5 bg-[#fafaf8] rounded-lg text-sm">
                          <div className="flex items-center gap-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${invoiceStatusStyles[inv.status] || invoiceStatusStyles.draft}`}>
                              {inv.status}
                            </span>
                            <span className="text-slate-700">{inv.description}</span>
                          </div>
                          <div className="flex items-center gap-3 text-slate-500">
                            <span className="font-semibold text-slate-900">${(inv.amount_cents / 100).toLocaleString()}</span>
                            <span className="text-xs">{formatDate(inv.created_at)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
