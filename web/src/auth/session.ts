/**
 * Where the signed-in session lives in the browser.
 *
 * Tokens and the public user view are kept in sessionStorage: they survive a page reload but not a closed
 * tab. Known limit: anything running on this origin (an XSS bug) could read them. A production build would
 * move the refresh token into an httpOnly cookie; that needs a backend change and is out of scope here.
 */
export type Role = 'CUSTOMER' | 'ADMIN' | 'DEMO_VIEWER';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  isDemo: boolean;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
}

const KEY = 'atelier-noor.session';
type Listener = () => void;
const listeners = new Set<Listener>();

let current: Session | null = load();

function load(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Session>;
    if (typeof value.accessToken === 'string' && typeof value.refreshToken === 'string' && value.user) {
      return value as Session;
    }
  } catch {
    /* storage unavailable or corrupt: behave as signed out */
  }
  return null;
}

function persist() {
  try {
    if (current) sessionStorage.setItem(KEY, JSON.stringify(current));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* ignore: the in-memory session still works for this page */
  }
}

export const getSession = () => current;

export function setSession(next: Session | null) {
  current = next;
  persist();
  listeners.forEach((l) => l());
}

export function subscribeSession(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test helper: re-read storage. */
export function reloadSessionFromStorage() {
  current = load();
  listeners.forEach((l) => l());
}
