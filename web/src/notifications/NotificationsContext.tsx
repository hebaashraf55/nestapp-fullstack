import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { type AppNotification, getNotifications, markAllNotificationsRead, markNotificationRead } from '../api/client';
import { useAuth } from '../auth/AuthContext';

interface NotificationsValue {
  items: AppNotification[];
  unread: number;
  refresh: () => void;
  markRead: (id: string) => Promise<void>;
  markAll: () => Promise<void>;
}
const Ctx = createContext<NotificationsValue | null>(null);
const POLL_MS = 60_000;

/** Customers' notifications, refreshed every minute while the tab is visible. */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const customer = user?.role === 'CUSTOMER';
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!customer) {
      setItems([]);
      setUnread(0);
      return;
    }
    let cancelled = false;
    const load = () => {
      if (document.visibilityState === 'hidden') return;
      getNotifications()
        .then((r) => {
          if (cancelled || !r || !Array.isArray(r.items)) return;
          setItems(r.items);
          setUnread(r.unread);
        })
        .catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [customer, user?.id, nonce]);

  const markRead = useCallback(async (id: string) => {
    const r = await markNotificationRead(id);
    setItems((list) => list.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnread(r.unread);
  }, []);
  const markAll = useCallback(async () => {
    await markAllNotificationsRead();
    setItems((list) => list.map((n) => ({ ...n, read: true })));
    setUnread(0);
  }, []);
  const value = useMemo(
    () => ({ items, unread, refresh: () => setNonce((n) => n + 1), markRead, markAll }),
    [items, unread, markRead, markAll],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotifications(): NotificationsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useNotifications must be used inside <NotificationsProvider>');
  return v;
}
