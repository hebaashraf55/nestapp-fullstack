import { useEffect, useRef, useState } from 'react';
import { getGoogleNonce } from '../api/client';
import { getTheme, THEME_EVENT } from '../theme/theme';

/** Minimal typing for Google Identity Services (https://accounts.google.com/gsi/client). */
interface GoogleId {
  initialize(options: {
    client_id: string;
    callback: (response: { credential?: string }) => void;
    nonce: string;
    ux_mode: 'popup';
    auto_select: boolean;
    cancel_on_tap_outside: boolean;
    use_fedcm_for_button?: boolean;
  }): void;
  renderButton(el: HTMLElement, options: Record<string, string | number>): void;
  cancel(): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

export const GOOGLE_CLIENT_ID: string | undefined = import.meta.env.VITE_GOOGLE_CLIENT_ID || undefined;
const SCRIPT_SRC = 'https://accounts.google.com/gsi/client?hl=en';

let scriptPromise: Promise<void> | null = null;
function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error('Google sign-in could not be loaded'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/**
 * Google's own "Continue with Google" button (its branding rules require their rendering). Popup
 * mode: the user stays on NOMA. Every attempt uses a fresh server nonce; the ID token Google returns
 * is posted to the API, which verifies it. Closing the popup simply does nothing.
 */
export function GoogleSignInButton({ onCredential, disabled }: { onCredential: (credential: string, nonceToken: string) => Promise<void>; disabled?: boolean }) {
  const slot = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [attempt, setAttempt] = useState(0);
  const handler = useRef(onCredential);
  handler.current = onCredential;

  // Google draws its own button, so redraw it (with a fresh nonce) when the theme changes.
  useEffect(() => {
    const redraw = () => setAttempt((n) => n + 1);
    window.addEventListener(THEME_EVENT, redraw);
    return () => window.removeEventListener(THEME_EVENT, redraw);
  }, []);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ nonce, nonceToken }] = await Promise.all([getGoogleNonce(), loadGoogleScript()]);
        const id = window.google?.accounts?.id;
        if (cancelled || !id || !slot.current) return;
        id.initialize({
          client_id: GOOGLE_CLIENT_ID as string,
          nonce,
          ux_mode: 'popup',
          auto_select: false,
          cancel_on_tap_outside: true,
          use_fedcm_for_button: true,
          callback: (response) => {
            if (!response.credential) return; // cancelled or blocked: nothing to do
            void handler.current(response.credential, nonceToken).finally(() => setAttempt((n) => n + 1));
          },
        });
        id.renderButton(slot.current, {
          type: 'standard',
          theme: getTheme() === 'dark' ? 'filled_black' : 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'center',
          locale: 'en', // the site is in English; Google would otherwise follow the browser language
          // Google caps the button at 400 px; fill the form up to that.
          width: Math.min(400, Math.max(200, Math.round(slot.current.parentElement?.getBoundingClientRect().width ?? 320))),
        });
        setState('ready');
      } catch {
        if (!cancelled) setState('unavailable');
      }
    })();
    return () => {
      cancelled = true;
      window.google?.accounts?.id?.cancel();
    };
  }, [attempt]);

  if (!GOOGLE_CLIENT_ID) return null;
  return (
    <div className="google-signin" aria-busy={state === 'loading'} data-disabled={disabled || undefined}>
      <div ref={slot} className="google-signin__slot" />
      {state === 'loading' && <p className="muted">Loading Google sign-in…</p>}
      {state === 'unavailable' && (
        <p className="muted" role="status">
          Google sign-in is unavailable right now. You can still use your email and password.
        </p>
      )}
    </div>
  );
}
