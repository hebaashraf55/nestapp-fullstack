import { type FormEvent, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { getSession } from '../auth/session';
import { GOOGLE_CLIENT_ID, GoogleSignInButton } from '../components/GoogleSignInButton';
import { PasswordField } from '../components/PasswordField';

/** Staff land on the admin dashboard, customers on their cart, unless they were sent here from a page. */
const homeFor = (role: string | undefined) => (role === 'ADMIN' || role === 'DEMO_VIEWER' ? '/admin' : '/cart');

export function Login() {
  const { user, signIn, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { from?: string; notice?: string; email?: string } | null;
  const from = state?.from;
  const safeFrom = from && from.startsWith('/') && !from.startsWith('//') ? from : null;
  const [email, setEmail] = useState(state?.email ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);

  if (user) return <Navigate to={safeFrom ?? homeFor(user.role)} replace />;

  const finish = () => navigate(safeFrom ?? homeFor(getSession()?.user.role), { replace: true });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setUnverified(false);
    try {
      await signIn(email.trim(), password);
      finish();
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 403 && /not verified/i.test(err.message)) setUnverified(true);
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  };

  const google = async (credential: string, nonceToken: string) => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle(credential, nonceToken);
      finish();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="page page--narrow auth">
      <p className="eyebrow">Welcome back</p>
      <h1 className="h1--small">Sign in</h1>
      {state?.notice && (
        <p className="notice" role="status">
          {state.notice}
        </p>
      )}

      {GOOGLE_CLIENT_ID && (
        <>
          <GoogleSignInButton onCredential={google} disabled={busy} />
          <p className="auth__divider" role="separator">
            <span>or sign in with email</span>
          </p>
        </>
      )}

      <form className="form" onSubmit={submit} aria-describedby={error ? 'login-error' : undefined}>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
        <p className="auth__row">
          <Link to="/forgot-password" state={{ email }}>
            Forgot password?
          </Link>
        </p>
        {error && (
          <p className="notice notice--bad" role="alert" id="login-error">
            {error}
            {unverified && (
              <>
                {' '}
                <Link to={`/verify-email?email=${encodeURIComponent(email.trim())}`}>Verify your email</Link>
              </>
            )}
          </p>
        )}
        <button type="submit" className="btn btn--block" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="auth__footer">
        New to NOMA? <Link to="/register">Create an account</Link>
      </p>
      <p className="muted">Demo accounts: demo-customer@example.com (shopping) and demo-viewer@example.com (read-only admin).</p>
    </div>
  );
}
