import { createContext, type ReactNode, useCallback, useContext, useMemo, useSyncExternalStore } from 'react';
import { login as apiLogin, logout as apiLogout } from '../api/client';
import { getSession, type SessionUser, setSession, subscribeSession } from './session';

interface AuthValue {
  user: SessionUser | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(subscribeSession, getSession, getSession);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await apiLogin(email, password);
    setSession({
      accessToken: result.Credentials.accessToken,
      refreshToken: result.Credentials.refreshToken,
      user: result.user,
    });
  }, []);

  const signOut = useCallback(async () => {
    const current = getSession();
    setSession(null); // sign out locally first so the UI never lingers on a failed network call
    if (current) await apiLogout(current.refreshToken).catch(() => undefined);
  }, []);

  const value = useMemo(() => ({ user: session?.user ?? null, signIn, signOut }), [session, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
