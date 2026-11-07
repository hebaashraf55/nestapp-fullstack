import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  type AddAvailableResult,
  addManyToCart,
  addToCart,
  applyCoupon,
  removeCoupon,
  type Cart,
  type CartLineInput,
  getCart,
  mergeCart,
  quoteCart,
  removeCartItem,
  updateCartItem,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';

interface CartValue {
  cart: Cart | null;
  /** loading: first fetch in flight; ready: have a cart; error: could not load; signed-out: staff or viewer with nothing to load */
  status: 'signed-out' | 'loading' | 'ready' | 'error';
  error: string | null;
  itemCount: number;
  /** True when the cart lives in this browser (a visitor who is not signed in). */
  isGuest: boolean;
  /** The guest's lines, for guest checkout. */
  guestLines: CartLineInput[];
  /** What could not be carried over when a guest cart was merged at sign-in. */
  mergeNotice: AddAvailableResult['skipped'] | null;
  add: (productId: string, quantity: number) => Promise<void>;
  /** Several products in one step (a bundle or a look): all or nothing. */
  addMany: (items: CartLineInput[]) => Promise<void>;
  setQuantity: (productId: string, quantity: number) => Promise<void>;
  remove: (productId: string) => Promise<void>;
  applyCode: (code: string) => Promise<void>;
  removeCode: () => Promise<void>;
  /** After a guest order: the browser cart is emptied. */
  clearGuest: () => void;
  reload: () => void;
}

const CartContext = createContext<CartValue | null>(null);
const KEY = 'noma-cart';
const MAX_LINES = 50;

const readGuest = (): CartLineInput[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter(
        (l): l is CartLineInput =>
          typeof l === 'object' &&
          l !== null &&
          typeof (l as CartLineInput).productId === 'string' &&
          /^[0-9a-f]{24}$/.test((l as CartLineInput).productId) &&
          Number.isInteger((l as CartLineInput).quantity) &&
          (l as CartLineInput).quantity >= 1 &&
          (l as CartLineInput).quantity <= 99,
      )
      .slice(0, MAX_LINES);
  } catch {
    return [];
  }
};
const writeGuest = (lines: CartLineInput[]) => {
  try {
    if (lines.length) localStorage.setItem(KEY, JSON.stringify(lines));
    else localStorage.removeItem(KEY);
  } catch {
    // storage blocked: the cart lasts for this page view
  }
};
const combine = (lines: CartLineInput[], extra: CartLineInput[]) => {
  const next = lines.map((l) => ({ ...l }));
  for (const e of extra) {
    const hit = next.find((l) => l.productId === e.productId);
    if (hit) hit.quantity = Math.min(99, hit.quantity + e.quantity);
    else next.push({ ...e });
  }
  return next;
};

/**
 * Customers' carts live on the server; every action returns the server-priced cart. A visitor's cart
 * lives in this browser and is priced by the server too (POST /api/cart/quote). Signing in as a
 * customer merges it into the account.
 */
export function CartProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const role = user?.role ?? null;
  const isGuest = user === null;
  const [cart, setCart] = useState<Cart | null>(null);
  const [status, setStatus] = useState<CartValue['status']>('loading');
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [guestLines, setGuestLines] = useState<CartLineInput[]>(readGuest);
  const [mergeNotice, setMergeNotice] = useState<CartValue['mergeNotice']>(null);

  // Guests: price the browser cart on the server whenever it changes.
  useEffect(() => {
    if (!isGuest) return;
    if (guestLines.length === 0) {
      setCart({ items: [], itemCount: 0, subtotalCents: 0, bundles: [], bundleSavingsCents: 0, coupon: null, discountCents: 0, totalCents: 0, currency: 'USD', hasIssues: false, warnings: [] });
      setStatus('ready');
      return;
    }
    let cancelled = false;
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    quoteCart(guestLines)
      .then((c) => {
        if (cancelled) return;
        setCart(c);
        setError(null);
        setStatus('ready');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Unknown error');
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [isGuest, guestLines, nonce]);

  // Signed in: load the account's cart, first merging a guest cart into a customer account.
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    setStatus('loading');
    const pending = role === 'CUSTOMER' ? readGuest() : [];
    const load = pending.length
      ? mergeCart(pending).then((r) => {
          writeGuest([]);
          setGuestLines([]);
          setMergeNotice(r.skipped.length ? r.skipped : null);
          return r.cart;
        })
      : getCart(controller.signal);
    load
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
  }, [userId, role, nonce]);

  const run = useCallback(async (action: () => Promise<Cart>) => {
    setCart(await action());
    setError(null);
    setStatus('ready');
  }, []);

  /** Guest change: price first, and refuse what the server says cannot be bought. */
  const guestChange = useCallback(async (next: CartLineInput[], touched: string[]) => {
    const priced = await quoteCart(next);
    const bad = priced.items.find((i) => touched.includes(i.productId) && i.status !== 'ok');
    if (bad) {
      throw new Error(
        bad.status === 'unavailable'
          ? 'This product is no longer available'
          : bad.availableStock === 0
            ? 'This product is out of stock'
            : `Only ${bad.availableStock} available`,
      );
    }
    writeGuest(next);
    setGuestLines(next);
    setCart(priced);
  }, []);

  const value = useMemo<CartValue>(
    () => ({
      cart,
      status,
      error,
      itemCount: cart?.itemCount ?? 0,
      isGuest,
      guestLines,
      mergeNotice,
      add: (id, q) =>
        isGuest
          ? guestLines.length >= MAX_LINES && !guestLines.some((l) => l.productId === id)
            ? Promise.reject(new Error(`A cart can hold at most ${MAX_LINES} different items`))
            : guestChange(combine(guestLines, [{ productId: id, quantity: q }]), [id])
          : run(() => addToCart(id, q)),
      addMany: (items) =>
        isGuest
          ? guestChange(combine(guestLines, items), items.map((i) => i.productId))
          : run(() => addManyToCart(items)),
      setQuantity: (id, q) =>
        isGuest
          ? guestChange(
              q === 0 ? guestLines.filter((l) => l.productId !== id) : guestLines.map((l) => (l.productId === id ? { ...l, quantity: q } : l)),
              q === 0 ? [] : [id],
            )
          : run(() => updateCartItem(id, q)),
      remove: (id) => (isGuest ? guestChange(guestLines.filter((l) => l.productId !== id), []) : run(() => removeCartItem(id))),
      applyCode: (code) =>
        isGuest ? Promise.reject(new Error('Sign in to use a coupon code.')) : run(() => applyCoupon(code)),
      removeCode: () => (isGuest ? Promise.resolve() : run(() => removeCoupon())),
      clearGuest: () => {
        writeGuest([]);
        setGuestLines([]);
      },
      reload: () => setNonce((n) => n + 1),
    }),
    [cart, status, error, isGuest, guestLines, mergeNotice, run, guestChange],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart must be used inside <CartProvider>');
  return value;
}
