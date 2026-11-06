import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  addToWishlist,
  getRecentlyViewed,
  getWishlist,
  mergeRecentlyViewed,
  mergeWishlist,
  recordView as apiRecordView,
  removeFromWishlist,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';

/*
 * Wishlist, recently viewed and the comparison tray. Guests keep them in this browser; signed-in
 * customers keep wishlist and history on the server (their guest lists are merged in at sign-in and
 * then cleared locally). The comparison tray is per browser for everyone. Staff accounts keep
 * browser-only lists: they are not shoppers, and the demo viewer may not write.
 */
const KEYS = { wishlist: 'noma-wishlist', recent: 'noma-recent', compare: 'noma-compare' } as const;
export const COMPARE_MAX = 4;
const RECENT_MAX = 20;

const read = (key: string): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && /^[0-9a-f]{24}$/.test(x)) : [];
  } catch {
    return [];
  }
};
const write = (key: string, ids: string[]) => {
  try {
    if (ids.length) localStorage.setItem(key, JSON.stringify(ids));
    else localStorage.removeItem(key);
  } catch {
    // storage blocked: lists simply last for this page view
  }
};

interface ShopperValue {
  wishlist: string[];
  isWished: (id: string) => boolean;
  toggleWish: (id: string) => Promise<void>;
  recent: string[];
  recordView: (id: string) => void;
  compare: string[];
  toggleCompare: (id: string) => void;
  clearCompare: () => void;
}

const ShopperContext = createContext<ShopperValue | null>(null);

export function ShopperProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const server = user?.role === 'CUSTOMER';
  const userId = server ? user.id : null;
  const [wishlist, setWishlist] = useState<string[]>(() => read(KEYS.wishlist));
  const [recent, setRecent] = useState<string[]>(() => read(KEYS.recent));
  const [compare, setCompare] = useState<string[]>(() => read(KEYS.compare).slice(0, COMPARE_MAX));

  // Signing in as a customer: merge this browser's guest lists into the account, then use the server's.
  useEffect(() => {
    if (!userId) {
      setWishlist(read(KEYS.wishlist));
      setRecent(read(KEYS.recent));
      return;
    }
    let cancelled = false;
    (async () => {
      const guestWish = read(KEYS.wishlist);
      const guestRecent = read(KEYS.recent);
      try {
        const [w, r] = await Promise.all([
          guestWish.length ? mergeWishlist(guestWish) : getWishlist(),
          guestRecent.length ? mergeRecentlyViewed(guestRecent) : getRecentlyViewed(),
        ]);
        if (cancelled) return;
        write(KEYS.wishlist, []);
        write(KEYS.recent, []);
        setWishlist(w.productIds);
        setRecent(r.productIds);
      } catch {
        // keep the guest lists; they merge on the next successful sign-in
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const toggleWish = useCallback(
    async (id: string) => {
      const has = wishlist.includes(id);
      if (!server) {
        const next = has ? wishlist.filter((x) => x !== id) : [...wishlist, id];
        write(KEYS.wishlist, next);
        setWishlist(next);
        return;
      }
      setWishlist((w) => (has ? w.filter((x) => x !== id) : [...w, id])); // optimistic
      try {
        const list = has ? await removeFromWishlist(id) : await addToWishlist(id);
        setWishlist(list.productIds);
      } catch (e) {
        setWishlist((w) => (has ? [...w, id] : w.filter((x) => x !== id)));
        throw e;
      }
    },
    [wishlist, server],
  );

  const recordView = useCallback(
    (id: string) => {
      if (server) {
        void apiRecordView(id)
          .then((l) => setRecent(l.productIds))
          .catch(() => undefined);
        return;
      }
      setRecent((r) => {
        const next = [id, ...r.filter((x) => x !== id)].slice(0, RECENT_MAX);
        write(KEYS.recent, next);
        return next;
      });
    },
    [server],
  );

  const toggleCompare = useCallback((id: string) => {
    setCompare((c) => {
      const next = c.includes(id) ? c.filter((x) => x !== id) : c.length >= COMPARE_MAX ? c : [...c, id];
      write(KEYS.compare, next);
      return next;
    });
  }, []);
  const clearCompare = useCallback(() => {
    write(KEYS.compare, []);
    setCompare([]);
  }, []);

  const value = useMemo(
    () => ({
      wishlist,
      isWished: (id: string) => wishlist.includes(id),
      toggleWish,
      recent,
      recordView,
      compare,
      toggleCompare,
      clearCompare,
    }),
    [wishlist, toggleWish, recent, recordView, compare, toggleCompare, clearCompare],
  );
  return <ShopperContext.Provider value={value}>{children}</ShopperContext.Provider>;
}

export function useShopper(): ShopperValue {
  const value = useContext(ShopperContext);
  if (!value) throw new Error('useShopper must be used inside <ShopperProvider>');
  return value;
}
