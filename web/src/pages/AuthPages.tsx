import { type FormEvent, useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { forgotPassword, resendVerification, resetPassword, signup, verifyEmail } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { getSession } from '../auth/session';
import { GOOGLE_CLIENT_ID, GoogleSignInButton } from '../components/GoogleSignInButton';
import { PasswordField } from '../components/PasswordField';

/* Registration, email verification, forgot and reset password. The API answers sign-up, resend and
   forgot-password identically for known and unknown emails, so these screens never reveal accounts. */

const MIN_PASSWORD = 12;
const CODE = /^\d{6}$/;
const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
const RESEND_COOLDOWN_S = 60;

/** Length is what matters (NIST); the hint says so rather than demanding symbol rules. */
function passwordProblem(password: string, email: string): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password.length > 128) return 'Use at most 128 characters.';
  if (/^(.)\1+$/.test(password)) return 'Avoid repeating a single character.';
  if (email && password.toLowerCase().includes(email.split('@')[0]!.toLowerCase()) && email.split('@')[0]!.length >= 4)
    return 'Avoid using your email name in the password.';
  return null;
}

export function Register() {
  const { user, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/cart" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const p = passwordProblem(password, email.trim());
    setProblem(p);
    setError(null);
    if (p) return;
    setBusy(true);
    try {
      await signup(name.trim(), email.trim(), password);
      navigate(`/verify-email?email=${encodeURIComponent(email.trim())}`, { state: { sent: true } });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  const google = async (credential: string, nonceToken: string) => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle(credential, nonceToken);
      navigate(getSession()?.user.role === 'CUSTOMER' ? '/cart' : '/admin', { replace: true });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div className="page page--narrow auth">
      <p className="eyebrow">Join NOMA</p>
      <h1 className="h1--small">Create an account</h1>
      {GOOGLE_CLIENT_ID && (
        <>
          <GoogleSignInButton onCredential={google} disabled={busy} />
          <p className="auth__divider" role="separator">
            <span>or create one with email</span>
          </p>
        </>
      )}
      <form className="form" onSubmit={submit} noValidate>
        <label className="field">
          <span>Name</span>
          <input autoComplete="name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          hint={`At least ${MIN_PASSWORD} characters. A few unrelated words make a strong, memorable password.`}
          error={problem}
        />
        {error && (
          <p className="notice notice--bad" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--block" disabled={busy || !name.trim() || !email.trim()}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="auth__footer">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}

function useCooldown(initial: number) {
  const [left, setLeft] = useState(initial);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft] as const;
}

export function VerifyEmail() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const sent = (location.state as { sent?: boolean } | null)?.sent ?? false;
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    sent ? { ok: true, text: 'If this email can be registered, we have sent a 6-digit code. It expires in 10 minutes.' } : null,
  );
  const [cooldown, setCooldown] = useCooldown(sent ? RESEND_COOLDOWN_S : 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!CODE.test(code.trim())) {
      setMessage({ ok: false, text: 'Enter the 6-digit code from the email.' });
      return;
    }
    setBusy(true);
    try {
      await verifyEmail(email.trim(), code.trim());
      navigate('/login', { replace: true, state: { email: email.trim(), notice: 'Your email is verified. You can sign in now.' } });
    } catch (err) {
      setMessage({
        ok: false,
        text: /invalid or expired/i.test(errorText(err))
          ? 'That code is invalid, expired or already used. Request a new one below.'
          : errorText(err),
      });
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    try {
      await resendVerification(email.trim());
      setMessage({ ok: true, text: 'If the account still needs verifying, a new code is on its way. Earlier codes no longer work.' });
      setCooldown(RESEND_COOLDOWN_S);
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    }
    setBusy(false);
  };

  return (
    <div className="page page--narrow auth">
      <p className="eyebrow">One more step</p>
      <h1 className="h1--small">Verify your email</h1>
      <p className="lede lede--small">Enter the 6-digit code we emailed you. Your account can sign in once it is verified.</p>
      {message && (
        <p className={`notice${message.ok ? '' : ' notice--bad'}`} role={message.ok ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}
      <form className="form" onSubmit={submit} noValidate>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Code</span>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
        </label>
        <button type="submit" className="btn btn--block" disabled={busy || !email.trim()}>
          {busy ? 'Checking…' : 'Verify email'}
        </button>
      </form>
      <p className="auth__footer">
        No email?{' '}
        <button type="button" className="link" disabled={busy || cooldown > 0 || !email.trim()} onClick={() => void resend()}>
          {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
        </button>
      </p>
    </div>
  );
}

export function ForgotPassword() {
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState((location.state as { email?: string } | null)?.email ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await forgotPassword(email.trim());
      navigate(`/reset-password?email=${encodeURIComponent(email.trim())}`, { state: { sent: true } });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div className="page page--narrow auth">
      <p className="eyebrow">Account help</p>
      <h1 className="h1--small">Forgot your password?</h1>
      <p className="lede lede--small">Enter your email and we will send a 6-digit reset code if there is an account for it.</p>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {error && (
          <p className="notice notice--bad" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--block" disabled={busy}>
          {busy ? 'Sending…' : 'Send reset code'}
        </button>
      </form>
      <p className="auth__footer">
        Remembered it? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const sent = (location.state as { sent?: boolean } | null)?.sent ?? false;
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const p = passwordProblem(password, email.trim());
    setProblem(p);
    if (!CODE.test(code.trim())) {
      setError('Enter the 6-digit code from the email.');
      return;
    }
    if (p) return;
    setBusy(true);
    try {
      await resetPassword(email.trim(), code.trim(), password);
      navigate('/login', {
        replace: true,
        state: { email: email.trim(), notice: 'Your password was changed and every other session was signed out. Sign in with the new password.' },
      });
    } catch (err) {
      setError(/invalid or expired/i.test(errorText(err)) ? 'That code is invalid, expired or already used. Request a new one.' : errorText(err));
      setBusy(false);
    }
  };

  return (
    <div className="page page--narrow auth">
      <p className="eyebrow">Account help</p>
      <h1 className="h1--small">Choose a new password</h1>
      {sent && (
        <p className="notice" role="status">
          If there is an account for this email, a 6-digit code is on its way. It expires in 10 minutes and works once.
        </p>
      )}
      <form className="form" onSubmit={submit} noValidate>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Code</span>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
        </label>
        <PasswordField
          label="New password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          hint={`At least ${MIN_PASSWORD} characters.`}
          error={problem}
        />
        {error && (
          <p className="notice notice--bad" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--block" disabled={busy || !email.trim()}>
          {busy ? 'Saving…' : 'Set new password'}
        </button>
      </form>
      <p className="auth__footer">
        Need a new code? <Link to="/forgot-password" state={{ email }}>Send another</Link>
      </p>
    </div>
  );
}
