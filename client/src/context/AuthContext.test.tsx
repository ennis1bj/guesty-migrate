import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from './AuthContext';

vi.mock('../api', () => ({
  default: {
    post: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
}));

import api from '../api';
const mockApi = api as { post: ReturnType<typeof vi.fn> };

function TestConsumer({ onError }: { onError?: (e: Error) => void } = {}) {
  const { user, isAuthenticated, login, logout, register } = useAuth();
  const handleLogin = () => login('a@b.com', 'pass').catch((e: Error) => onError?.(e));
  const handleRegister = () => register('new@b.com', 'pass').catch((e: Error) => onError?.(e));
  return (
    <div>
      <span data-testid="auth">{isAuthenticated ? 'yes' : 'no'}</span>
      <span data-testid="email">{user?.email ?? ''}</span>
      <span data-testid="demo">{user?.is_demo ? 'demo' : 'regular'}</span>
      <button onClick={handleLogin}>login</button>
      <button onClick={handleRegister}>register</button>
      <button onClick={logout}>logout</button>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <AuthProvider>
      <TestConsumer />
    </AuthProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('AuthContext — initial state', () => {
  test('starts unauthenticated when localStorage is empty', () => {
    renderWithProvider();
    expect(screen.getByTestId('auth').textContent).toBe('no');
    expect(screen.getByTestId('email').textContent).toBe('');
  });

  test('restores session from localStorage on mount', async () => {
    localStorage.setItem('token', 'saved-token');
    localStorage.setItem('user', JSON.stringify({ id: '1', email: 'saved@example.com', is_demo: false }));

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('auth').textContent).toBe('yes');
      expect(screen.getByTestId('email').textContent).toBe('saved@example.com');
    });
  });
});

describe('AuthContext — login', () => {
  test('sets user and token on successful login', async () => {
    mockApi.post.mockResolvedValueOnce({
      data: {
        token: 'jwt-token',
        user: { id: '2', email: 'a@b.com', is_demo: false },
      },
    });

    renderWithProvider();
    await userEvent.click(screen.getByText('login'));

    await waitFor(() => {
      expect(screen.getByTestId('auth').textContent).toBe('yes');
      expect(screen.getByTestId('email').textContent).toBe('a@b.com');
    });

    expect(localStorage.getItem('token')).toBe('jwt-token');
  });

  test('leaves user unauthenticated when the API rejects', async () => {
    mockApi.post.mockRejectedValueOnce(new Error('Invalid credentials'));
    const onError = vi.fn();

    render(
      <AuthProvider>
        <TestConsumer onError={onError} />
      </AuthProvider>
    );

    await userEvent.click(screen.getByText('login'));

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(screen.getByTestId('auth').textContent).toBe('no');
  });
});

describe('AuthContext — register', () => {
  test('sets user and token on successful registration', async () => {
    mockApi.post.mockResolvedValueOnce({
      data: {
        token: 'new-token',
        user: { id: '3', email: 'new@b.com', is_demo: false },
      },
    });

    renderWithProvider();
    await userEvent.click(screen.getByText('register'));

    await waitFor(() => {
      expect(screen.getByTestId('auth').textContent).toBe('yes');
      expect(screen.getByTestId('email').textContent).toBe('new@b.com');
    });
  });
});

describe('AuthContext — logout', () => {
  test('clears user, token, and localStorage on logout', async () => {
    mockApi.post.mockResolvedValueOnce({
      data: {
        token: 'tok',
        user: { id: '4', email: 'logout@example.com', is_demo: false },
      },
    });

    renderWithProvider();
    await userEvent.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('auth').textContent).toBe('yes'));

    await userEvent.click(screen.getByText('logout'));

    await waitFor(() => {
      expect(screen.getByTestId('auth').textContent).toBe('no');
      expect(screen.getByTestId('email').textContent).toBe('');
    });

    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });
});

describe('AuthContext — demo user flag', () => {
  test('restores is_demo=true from localStorage', async () => {
    localStorage.setItem('token', 'demo-tok');
    localStorage.setItem('user', JSON.stringify({ id: '5', email: 'demo@guestymigrate.com', is_demo: true }));

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('demo').textContent).toBe('demo');
    });
  });
});

describe('useAuth outside provider', () => {
  test('throws when used outside AuthProvider', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const windowErrorHandler = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', windowErrorHandler);

    expect(() => render(<TestConsumer />)).toThrow('useAuth must be used within AuthProvider');

    window.removeEventListener('error', windowErrorHandler);
    errorSpy.mockRestore();
  });
});
