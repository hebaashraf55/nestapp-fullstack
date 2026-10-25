import { useEffect, useState } from 'react';
import { getHealth, type Health } from '../api/client';

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; health: Health }
  | { phase: 'down'; reason: string };

/** Live probe of GET /api/health: the only backend endpoint that exists at this milestone. */
export function ApiStatus() {
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    getHealth(controller.signal)
      .then((health) => setState({ phase: 'ready', health }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ phase: 'down', reason: error instanceof Error ? error.message : 'Unknown error' });
      });
    return () => controller.abort();
  }, []);

  return (
    <aside className="status" aria-live="polite" data-phase={state.phase}>
      <span className="status__dot" aria-hidden="true" />
      {state.phase === 'loading' && <span>Checking the API…</span>}
      {state.phase === 'ready' && (
        <span>
          API online · payments <strong>{state.health.paymentsMode}</strong>
        </span>
      )}
      {state.phase === 'down' && <span>API unavailable — {state.reason}</span>}
    </aside>
  );
}
