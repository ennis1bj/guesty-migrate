import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, isAuthenticated, authLoading } = useAuth();
  const navigate = useNavigate();

  // While the session check is in flight, render nothing so ProtectedRoute
  // doesn't race-redirect us. Once resolved, redirect already-logged-in users.
  if (authLoading) return null;
  if (isAuthenticated) {
    navigate('/dashboard', { replace: true });
    return null;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);

      // After a successful login, check whether there is an in-progress
      // migration (paid or running). If so, take the user directly to the
      // live progress view so they don't feel "locked out".
      try {
        const { data } = await api.get('/migrations');
        const active = (data.migrations ?? []).find(
          (m: { id: string; status: string }) =>
            m.status === 'running' || m.status === 'paid'
        );
        if (active) {
          navigate(`/migrate?step=progress&migrationId=${active.id}`, { replace: true });
          return;
        }
      } catch {
        // If the migrations fetch fails, fall through to the default destination.
      }

      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Welcome back</h1>
          <p className="text-slate-500 mt-2">Sign in to your GuestyMigrate account</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 border border-stone-300 rounded-xl bg-white text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 outline-none transition-colors"
              required
            />
          </div>

          <div className="mb-2">
            <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1.5">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 border border-stone-300 rounded-xl bg-white text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 outline-none transition-colors"
              required
            />
          </div>

          <div className="mb-6 text-right">
            <Link to="/forgot-password" className="text-sm text-amber-600 hover:text-amber-700 font-medium">
              Forgot password?
            </Link>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 py-3 rounded-xl font-semibold shadow-sm hover:shadow-md disabled:opacity-50 transition-all duration-200"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>

          <p className="text-center text-sm text-slate-500 mt-4">
            Don't have an account?{' '}
            <Link to="/register" className="text-amber-600 font-medium hover:text-amber-700">
              Sign up
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
