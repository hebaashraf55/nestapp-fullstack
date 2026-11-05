import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setSession } from '../src/auth/session';

const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data, timestamp: 't' }), { status });
const fail = (statusCode: number, message: string) =>
  new Response(JSON.stringify({ success: false, error: { statusCode, error: 'x', message }, timestamp: 't' }), { status: statusCode });
const LOGIN = (role = 'CUSTOMER') => ({
  Credentials: { accessToken: 'a', refreshToken: 'r'.repeat(24) },
  user: { id: 'u'.repeat(24), email: 'ada@example.com', name: 'Ada', role, isDemo: false },
});
const EMPTY_CART = { items: [], itemCount: 0, subtotalCents: 0, coupon: null, discountCents: 0, totalCents: 0, currency: 'USD', hasIssues: false, warnings: [] };

interface Call {
  method: string;
  path: string;
  body: unknown;
}
function mockApi(handler: (c: Call) => Response | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const call = { method: init?.method ?? 'GET', path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      const custom = handler(call);
      if (custom) return Promise.resolve(custom);
      if (url.pathname === '/api/cart') return Promise.resolve(ok(EMPTY_CART));
      if (url.pathname === '/api/health') return Promise.resolve(ok({ status: 'ok', paymentsMode: 'simulated' }));
      return Promise.resolve(fail(404, 'Not found'));
    }),
  );
  return calls;
}

async function renderApp(path: string) {
  const { App } = await import('../src/App');
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => setSession(null));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
  setSession(null);
  delete window.google;
});

describe('sign-in screen', () => {
  it('shows and hides the password with an accessible toggle, and links to account help', async () => {
    mockApi(() => undefined);
    await renderApp('/login');
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    await userEvent.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password');
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/register');
    // Without a Google client id the Google button is not offered at all.
    expect(screen.queryByText(/or sign in with email/i)).not.toBeInTheDocument();
  });

  it('offers verification when the account is not verified yet', async () => {
    mockApi((c) => (c.path === '/api/auth/login' ? fail(403, 'Email not verified') : undefined));
    await renderApp('/login');
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'a long enough password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email not verified');
    expect(screen.getByRole('link', { name: 'Verify your email' })).toHaveAttribute('href', '/verify-email?email=ada%40example.com');
  });
});

describe('Continue with Google', () => {
  it('uses a server nonce, posts only Google’s credential and the ticket, then signs the customer in', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '123-abc.apps.googleusercontent.com');
    let options: { nonce: string; client_id: string; callback: (r: { credential?: string }) => void } | undefined;
    window.google = {
      accounts: {
        id: {
          initialize: (o) => {
            options = o as typeof options;
          },
          renderButton: (el) => {
            el.textContent = 'Continue with Google';
          },
          cancel: () => undefined,
        },
      },
    };
    const calls = mockApi((c) => {
      if (c.path === '/api/auth/google/nonce') return ok({ nonce: 'nonce-1', nonceToken: 'ticket-1-xxxxxxxxxxxxxxxx' });
      if (c.path === '/api/auth/google') return ok(LOGIN());
      return undefined;
    });
    await renderApp('/login');
    expect(await screen.findByText('Continue with Google')).toBeInTheDocument();
    expect(screen.getByText(/or sign in with email/i)).toBeInTheDocument();
    expect(options).toMatchObject({ client_id: '123-abc.apps.googleusercontent.com', nonce: 'nonce-1' });

    options!.callback({}); // the user closed the popup: nothing is sent
    expect(calls.some((c) => c.path === '/api/auth/google')).toBe(false);

    options!.callback({ credential: 'google.id.token' });
    expect(await screen.findByRole('heading', { name: 'Your cart' })).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/auth/google')!.body).toEqual({ credential: 'google.id.token', nonceToken: 'ticket-1-xxxxxxxxxxxxxxxx' });
  });

  it('shows the server’s refusal (for example a staff email) and stays on the sign-in page', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '123-abc.apps.googleusercontent.com');
    let callback: ((r: { credential?: string }) => void) | undefined;
    window.google = {
      accounts: { id: { initialize: (o) => (callback = o.callback), renderButton: () => undefined, cancel: () => undefined } },
    };
    mockApi((c) => {
      if (c.path === '/api/auth/google/nonce') return ok({ nonce: 'n', nonceToken: 'ticket-xxxxxxxxxxxxxxxxxxxx' });
      if (c.path === '/api/auth/google') return fail(403, 'This account signs in with its email and password.');
      return undefined;
    });
    await renderApp('/login');
    await waitFor(() => expect(callback).toBeDefined());
    callback!({ credential: 'google.id.token' });
    expect(await screen.findByRole('alert')).toHaveTextContent('This account signs in with its email and password.');
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('registration and verification', () => {
  it('checks password strength before sending, then registers and asks for the code', async () => {
    const calls = mockApi((c) => (c.path === '/api/auth/signup' ? ok({ message: 'm' }, 202) : undefined));
    await renderApp('/register');
    await userEvent.type(screen.getByLabelText('Name'), 'Ada');
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Use at least 12 characters.')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((c) => c.path === '/api/auth/signup')).toBe(false);

    await userEvent.clear(screen.getByLabelText('Password'));
    await userEvent.type(screen.getByLabelText('Password'), 'quiet linen morning walk');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: 'Verify your email' })).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/auth/signup')!.body).toEqual({ name: 'Ada', email: 'ada@example.com', password: 'quiet linen morning walk' });
    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com');
    expect(screen.getByRole('button', { name: /Send a new code in \d+s/ })).toBeDisabled(); // resend cool-down
  });

  it('explains an invalid, expired or used code, then verifies and goes to sign in', async () => {
    let attempts = 0;
    mockApi((c) => (c.path === '/api/auth/verify-email' ? (++attempts === 1 ? fail(400, 'Invalid or expired code') : ok({ verified: true })) : undefined));
    await renderApp('/verify-email?email=ada%40example.com');
    await userEvent.type(screen.getByLabelText('Code'), '12');
    await userEvent.click(screen.getByRole('button', { name: 'Verify email' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the 6-digit code');
    await userEvent.type(screen.getByLabelText('Code'), '3456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid, expired or already used');
    await userEvent.click(screen.getByRole('button', { name: 'Verify email' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Your email is verified');
  });
});

describe('forgot and reset password', () => {
  it('requests a code without revealing accounts, then resets and signs everything out', async () => {
    const calls = mockApi((c) => {
      if (c.path === '/api/auth/forgot-password') return ok({ message: 'm' }, 202);
      if (c.path === '/api/auth/reset-password') return ok({ passwordReset: true });
      return undefined;
    });
    await renderApp('/forgot-password');
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset code' }));
    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('If there is an account for this email');

    await userEvent.type(screen.getByLabelText('Code'), '654321');
    await userEvent.type(screen.getByLabelText('New password'), 'a brand new long password');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('every other session was signed out');
    expect(calls.find((c) => c.path === '/api/auth/reset-password')!.body).toEqual({
      email: 'ada@example.com',
      code: '654321',
      newPassword: 'a brand new long password',
    });
  });

  it('shows a clear message for a bad code', async () => {
    mockApi((c) => (c.path === '/api/auth/reset-password' ? fail(400, 'Invalid or expired code') : undefined));
    await renderApp('/reset-password?email=ada%40example.com');
    await userEvent.type(screen.getByLabelText('Code'), '000000');
    await userEvent.type(screen.getByLabelText('New password'), 'a brand new long password');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid, expired or already used');
  });
});
