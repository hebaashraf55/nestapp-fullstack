import { type FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getSession } from '../auth/session';

/** Staff land on the admin dashboard, customers on their cart, unless they were sent here from a page. */
const homeFor = (role: string | undefined) => (role === 'ADMIN' || role === 'DEMO_VIEWER' ? '/admin' : '/cart');

export function Login() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const safeFrom = from && from.startsWith('/') && !from.startsWith('//') ? from : null;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to={safeFrom ?? homeFor(user.role)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      navigate(safeFrom ?? homeFor(getSession()?.user.role), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  };

  return (
    <div className="page page--narrow">
      <p className="eyebrow">Welcome back</p>
      <h1 className="h1--small">Sign in</h1>
      <p className="lede lede--small">
        Use an account created by the backend seed (for example the demo customer). Account creation in the
        browser is not part of this milestone.
      </p>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && (
          <p className="notice notice--bad" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
