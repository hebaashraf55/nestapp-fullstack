import { createContext, type ReactNode, useCallback, useContext, useMemo, useSyncExternalStore } from 'react';
import { googleSignIn as apiGoogleSignIn, login as apiLogin, type LoginResult, logout as apiLogout } from '../api/client';
import { getSession, type SessionUser, setSession, subscribeSession } from './session';

interface AuthValue {
  user: SessionUser | null;
  signIn: (email: string, password: string) => Promise<void>;
  /** Exchanges a verified Google ID token (plus the server's nonce ticket) for a normal session. */
  signInWithGoogle: (credential: string, nonceToken: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/** Both sign-in methods end in the same session: the API's access + refresh tokens and the public user. */
const adopt = (result: LoginResult) =>
  setSession({
    accessToken: result.Credentials.accessToken,
    refreshToken: result.Credentials.refreshToken,
    user: result.user,
  });

export function AuthProvider({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(subscribeSession, getSession, getSession);

  const signIn = useCallback(async (email: string, password: string) => {
    adopt(await apiLogin(email, password));
  }, []);

  const signInWithGoogle = useCallback(async (credential: string, nonceToken: string) => {
    adopt(await apiGoogleSignIn(credential, nonceToken));
  }, []);

  const signOut = useCallback(async () => {
    const current = getSession();
    setSession(null); // sign out locally first so the UI never lingers on a failed network call
    if (current) await apiLogout(current.refreshToken).catch(() => undefined);
  }, []);

  const value = useMemo(
    () => ({ user: session?.user ?? null, signIn, signInWithGoogle, signOut }),
    [session, signIn, signInWithGoogle, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
