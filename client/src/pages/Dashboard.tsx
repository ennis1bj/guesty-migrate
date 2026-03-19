import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api';

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

const statusStyles: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-800',
  paid: 'bg-blue-100 text-blue-800',
  running: 'bg-indigo-100 text-indigo-800',
  complete: 'bg-green-100 text-green-800',
  complete_with_errors: 'bg-yellow-100 text-yellow-800',
  failed: 'bg-red-100 text-red-800',
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [migrations, setMigrations] = useState<Migration[]>([]);
  const [loading, setLoading] = useState(true);

  const handleRetry = async (migrationId: string) => {
    try {
      await api.post(`/migrations/${migrationId}/retry`);
      navigate(`/migrate?step=progress&migrationId=${migrationId}`);
    } catch (err) {
      console.error('Retry failed:', err);
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
        <div className="animate-spin w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full mx-auto" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600 mt-1">Your migration history</p>
        </div>
        <Link
          to="/migrate"
          className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-semibold hover:bg-indigo-700 transition-colors"
        >
          New Migration
        </Link>
      </div>

      {migrations.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">No migrations yet</h2>
          <p className="text-gray-600 mb-6">Start your first Guesty account migration.</p>
          <Link
            to="/migrate"
            className="inline-block bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-semibold hover:bg-indigo-700 transition-colors"
          >
            Start Migration
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {migrations.map((m) => (
            <div
              key={m.id}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusStyles[m.status] || statusStyles.pending}`}>
                    {m.status}
                  </span>
                  <span className="text-sm text-gray-500">
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
                      className="text-sm text-indigo-600 hover:underline mr-4"
                      title="Re-run the migration. Only categories that were not previously completed will be retried. You will not be charged again."
                    >
                      Retry
                    </button>
                  )}
                  <Link
                    to={`/migrate?step=progress&migrationId=${m.id}`}
                    className="text-indigo-600 hover:text-indigo-700 text-sm font-medium"
                  >
                    View Details
                  </Link>
                </div>
              </div>

              <p className="text-sm text-gray-500 mb-3 font-mono">{m.id}</p>

              {m.manifest && (
                <div className="flex flex-wrap gap-3">
                  {Object.entries(m.manifest).map(([cat, count]) => (
                    <div key={cat} className="bg-gray-50 px-3 py-1.5 rounded-lg">
                      <span className="text-xs text-gray-500 capitalize">{cat}</span>
                      <span className="ml-2 text-sm font-semibold text-gray-900">{(count as number).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}

              {m.completed_at && (
                <p className="text-xs text-gray-400 mt-3">
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
