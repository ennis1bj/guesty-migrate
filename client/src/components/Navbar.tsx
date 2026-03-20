import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { isAuthenticated, user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/');
    setMobileOpen(false);
  };

  const isActive = (path: string) =>
    location.pathname === path
      ? 'text-white'
      : 'text-slate-300 hover:text-white';

  const mobileActive = (path: string) =>
    location.pathname === path
      ? 'text-white font-semibold'
      : 'text-slate-300 hover:text-white';

  return (
    <nav className="bg-slate-900 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">

          {/* Logo */}
          <Link to="/" className="flex items-center space-x-2.5 shrink-0" onClick={() => setMobileOpen(false)}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-label="GuestyMigrate logo">
              <rect width="32" height="32" rx="8" fill="#f59e0b" />
              <path d="M8 16 L14 22 L24 10" stroke="#0f172a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-lg font-bold text-white tracking-tight">GuestyMigrate</span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center space-x-6">
            {isAuthenticated ? (
              <>
                <Link to="/" className={`${isActive('/')} text-sm font-medium transition-colors`}>
                  Home
                </Link>
                <Link to="/dashboard" className={`${isActive('/dashboard')} text-sm font-medium transition-colors`}>
                  Dashboard
                </Link>
                {user?.is_admin && (
                  <Link to="/admin" className={`${isActive('/admin')} text-purple-400 hover:text-purple-300 text-sm font-medium transition-colors`}>
                    Admin
                  </Link>
                )}
                <Link
                  to="/migrate"
                  className="bg-amber-500 hover:bg-amber-600 text-slate-900 px-5 py-2 rounded-xl text-sm font-semibold transition-all duration-200 shadow-sm hover:shadow-md"
                >
                  New Migration
                </Link>
                <div className="flex items-center gap-2 border-l border-slate-700 pl-6">
                  {user?.is_beta && (
                    <span className="bg-purple-500/20 text-purple-300 text-xs font-bold px-2 py-0.5 rounded-full">BETA</span>
                  )}
                  <span className="text-slate-400 text-sm max-w-[160px] truncate" title={user?.email}>
                    {user?.email}
                  </span>
                  <button
                    onClick={handleLogout}
                    className="text-slate-400 hover:text-white text-sm font-medium transition-colors ml-1"
                  >
                    Logout
                  </button>
                </div>
              </>
            ) : (
              <>
                <a href="/#how-it-works" className="text-slate-300 hover:text-white text-sm font-medium transition-colors">
                  How It Works
                </a>
                <a href="/#pricing" className="text-slate-300 hover:text-white text-sm font-medium transition-colors">
                  Pricing
                </a>
                <Link to="/login" className={`${isActive('/login')} text-sm font-medium transition-colors`}>
                  Login
                </Link>
                <Link
                  to="/register"
                  className="bg-amber-500 hover:bg-amber-600 text-slate-900 px-5 py-2 rounded-xl text-sm font-semibold transition-all duration-200 shadow-sm hover:shadow-md"
                >
                  Start Migration
                </Link>
              </>
            )}
          </div>

          {/* Mobile Hamburger */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden text-slate-300 hover:text-white p-2"
            aria-label="Toggle menu"
          >
            {mobileOpen ? (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="md:hidden bg-slate-800 border-t border-slate-700 px-4 py-4 space-y-1">
          {isAuthenticated ? (
            <>
              <Link
                to="/"
                className={`block ${mobileActive('/')} text-sm font-medium py-2.5`}
                onClick={() => setMobileOpen(false)}
              >
                Home
              </Link>
              <Link
                to="/dashboard"
                className={`block ${mobileActive('/dashboard')} text-sm font-medium py-2.5`}
                onClick={() => setMobileOpen(false)}
              >
                Dashboard
              </Link>
              {user?.is_admin && (
                <Link
                  to="/admin"
                  className="block text-purple-400 hover:text-purple-300 text-sm font-medium py-2.5"
                  onClick={() => setMobileOpen(false)}
                >
                  Admin
                </Link>
              )}
              <div className="pt-1">
                <Link
                  to="/migrate"
                  className="block bg-amber-500 hover:bg-amber-600 text-slate-900 px-5 py-2.5 rounded-xl text-sm font-semibold text-center transition-all"
                  onClick={() => setMobileOpen(false)}
                >
                  New Migration
                </Link>
              </div>
              <div className="border-t border-slate-700 pt-3 mt-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {user?.is_beta && (
                    <span className="bg-purple-500/20 text-purple-300 text-xs font-bold px-2 py-0.5 rounded-full">BETA</span>
                  )}
                  <span className="text-slate-400 text-sm truncate max-w-[180px]">{user?.email}</span>
                </div>
                <button
                  onClick={handleLogout}
                  className="text-slate-400 hover:text-white text-sm font-medium transition-colors"
                >
                  Logout
                </button>
              </div>
            </>
          ) : (
            <>
              <a
                href="/#how-it-works"
                className="block text-slate-300 hover:text-white text-sm font-medium py-2.5"
                onClick={() => setMobileOpen(false)}
              >
                How It Works
              </a>
              <a
                href="/#pricing"
                className="block text-slate-300 hover:text-white text-sm font-medium py-2.5"
                onClick={() => setMobileOpen(false)}
              >
                Pricing
              </a>
              <Link
                to="/login"
                className={`block ${mobileActive('/login')} text-sm font-medium py-2.5`}
                onClick={() => setMobileOpen(false)}
              >
                Login
              </Link>
              <div className="pt-1">
                <Link
                  to="/register"
                  className="block bg-amber-500 hover:bg-amber-600 text-slate-900 px-5 py-2.5 rounded-xl text-sm font-semibold text-center transition-all"
                  onClick={() => setMobileOpen(false)}
                >
                  Start Migration
                </Link>
              </div>
            </>
          )}
        </div>
      )}
    </nav>
  );
}
