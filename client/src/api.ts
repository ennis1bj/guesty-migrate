import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

// Public paths where a 401 is normal (unauthenticated visitor) — never redirect from these
const PUBLIC_PATHS = ['/', '/login', '/register', '/forgot-password', '/reset-password', '/terms', '/privacy', '/preview'];

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Only redirect to /login on 401 (unauthenticated).
    // 403 (forbidden/insufficient permissions) means the user IS logged in but blocked
    // for a specific reason (e.g. unverified email) — the component handles that inline.
    if (error.response?.status === 401) {
      // /auth/me returning 401 just means the user isn't logged in — AuthContext handles it
      const isAuthCheck = error.config?.url === '/auth/me';

      const path = window.location.pathname;
      const isPublicPage = PUBLIC_PATHS.some((p) => path === p || path.startsWith('/preview'));

      if (!isAuthCheck && !isPublicPage) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
