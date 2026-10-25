import { useEffect, useState } from 'react';

export type Remote<T> =
  | { phase: 'loading' }
  | { phase: 'ready'; data: T }
  | { phase: 'error'; error: Error };

/** Runs an abortable request whenever `key` changes and exposes loading / ready / error. */
export function useRemote<T>(load: (signal: AbortSignal) => Promise<T>, key: string): Remote<T> {
  const [state, setState] = useState<Remote<T>>({ phase: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: 'loading' });
    load(controller.signal)
      .then((data) => setState({ phase: 'ready', data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ phase: 'error', error: error instanceof Error ? error : new Error('Unknown error') });
      });
    return () => controller.abort();
    // `key` describes everything `load` depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}
