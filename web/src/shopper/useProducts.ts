import { useEffect, useState } from 'react';
import { getProduct, type Product } from '../api/client';

/** Loads products by id, in order, skipping any that no longer exist. */
export function useProductsById(ids: string[]): { loading: boolean; items: Product[] } {
  const key = ids.join(',');
  const [state, setState] = useState<{ key: string; items: Product[] }>({ key: '', items: [] });
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    void Promise.all(key.split(',').map((id) => getProduct(id, controller.signal).catch(() => null))).then((list) => {
      if (!controller.signal.aborted) setState({ key, items: list.filter((p): p is Product => p !== null) });
    });
    return () => controller.abort();
  }, [key]);
  if (!key) return { loading: false, items: [] };
  return { loading: state.key !== key, items: state.key === key ? state.items : [] };
}
