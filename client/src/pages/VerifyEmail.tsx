import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const { isAuthenticated } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState('');
  const [resendStatus, setResendStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle');
  const [resendError, setResendError] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError('No verification token found.');
      return;
    }

    api.get(`/auth/verify/${token}`)
      .then(() => setStatus('success'))
      .catch((err) => {
        setStatus('error');
        setError(err.response?.data?.error || 'Verification failed');
      });
  }, [token]);

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

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8 text-center">
          {status === 'loading' && (
            <>
              <div className="animate-spin w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full mx-auto mb-4" />
              <h2 className="text-xl font-bold text-slate-900">Verifying your email...</h2>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">Email Verified</h2>
              <p className="text-slate-500 mb-6">Your email has been verified successfully.</p>
              <Link
                to="/dashboard"
                className="inline-block bg-amber-500 hover:bg-amber-600 text-slate-900 px-6 py-2.5 rounded-xl font-semibold shadow-sm hover:shadow-md transition-all duration-200"
              >
                Go to Dashboard
              </Link>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">Verification Failed</h2>
              <p className="text-slate-500 mb-6">{error}</p>

              {/* Resend section — always visible */}
              <div className="mb-6 p-4 bg-stone-50 border border-stone-200 rounded-xl text-left">
                <p className="text-sm font-semibold text-slate-700 mb-1">Need a new link?</p>
                {isAuthenticated ? (
                  resendStatus === 'sent' ? (
                    <p className="text-sm text-emerald-600 font-medium">Verification email sent — check your inbox.</p>
                  ) : (
                    <>
                      <p className="text-sm text-slate-500 mb-3">Request a fresh verification email below.</p>
                      {resendStatus === 'error' && (
                        <p className="text-sm text-red-600 mb-2">{resendError}</p>
                      )}
                      <button
                        onClick={handleResend}
                        disabled={resendStatus === 'loading'}
                        className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-slate-900 px-4 py-2 rounded-xl text-sm font-semibold shadow-sm hover:shadow-md transition-all duration-200"
                      >
                        {resendStatus === 'loading' ? 'Sending…' : 'Resend verification email'}
                      </button>
                    </>
                  )
                ) : (
                  <p className="text-sm text-slate-500">
                    <Link to="/login" className="font-semibold text-amber-600 hover:text-amber-700 underline underline-offset-2">
                      Log in
                    </Link>
                    {' '}to your account and request a new verification link from your dashboard.
                  </p>
                )}
              </div>

              <Link
                to="/login"
                className="inline-block text-sm text-slate-500 hover:text-slate-700 underline underline-offset-2"
              >
                Back to Login
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
