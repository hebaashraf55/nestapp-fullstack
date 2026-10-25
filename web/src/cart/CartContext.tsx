import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  addToCart,
  applyCoupon,
  type Cart,
  getCart,
  removeCartItem,
  updateCartItem,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';

interface CartValue {
  cart: Cart | null;
  /** loading: first fetch in flight; ready: have a cart; error: could not load; signed-out: nothing to load */
  status: 'signed-out' | 'loading' | 'ready' | 'error';
  error: string | null;
  itemCount: number;
  add: (productId: string, quantity: number) => Promise<void>;
  setQuantity: (productId: string, quantity: number) => Promise<void>;
  remove: (productId: string) => Promise<void>;
  applyCode: (code: string) => Promise<void>;
  reload: () => void;
}

const CartContext = createContext<CartValue | null>(null);

/** The cart always mirrors the server: every action returns the server-priced cart, which replaces local state. */
export function CartProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [cart, setCart] = useState<Cart | null>(null);
  const [status, setStatus] = useState<CartValue['status']>('signed-out');
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!userId) {
      setCart(null);
      setStatus('signed-out');
      return;
    }
    const controller = new AbortController();
    setStatus('loading');
    getCart(controller.signal)
      .then((c) => {
        setCart(c);
        setError(null);
        setStatus('ready');
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : 'Unknown error');
        setStatus('error');
      });
    return () => controller.abort();
  }, [userId, nonce]);

  const run = useCallback(async (action: () => Promise<Cart>) => {
    setCart(await action());
    setError(null);
    setStatus('ready');
  }, []);

  const value = useMemo<CartValue>(
    () => ({
      cart,
      status,
      error,
      itemCount: cart?.itemCount ?? 0,
      add: (id, q) => run(() => addToCart(id, q)),
      setQuantity: (id, q) => run(() => updateCartItem(id, q)),
      remove: (id) => run(() => removeCartItem(id)),
      applyCode: (code) => run(() => applyCoupon(code)),
      reload: () => setNonce((n) => n + 1),
    }),
    [cart, status, error, run],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart must be used inside <CartProvider>');
  return value;
}
