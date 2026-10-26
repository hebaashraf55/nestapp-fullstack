import type { ReactNode } from 'react';
import { ApiError } from '../../api/client';
import type { Remote } from '../../hooks/useRemote';

/** Shared loading / error handling for the admin tables. 403 gets its own plain explanation. */
export function RemoteView<T>({ state, children }: { state: Remote<T>; children: (data: T) => ReactNode }) {
  if (state.phase === 'loading') {
    return (
      <p className="notice" aria-busy="true">
        Loading…
      </p>
    );
  }
  if (state.phase === 'error') {
    const denied = state.error instanceof ApiError && state.error.statusCode === 403;
    return (
      <p className="notice notice--bad" role="alert">
        {denied ? 'You do not have permission to see this.' : `We couldn’t load this. ${state.error.message}`}
      </p>
    );
  }
  return <>{children(state.data)}</>;
}
