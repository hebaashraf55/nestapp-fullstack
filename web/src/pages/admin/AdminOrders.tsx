import { useEffect, useState } from 'react';
import { type AdminOrder, getAdminOrders, type OrderStatus, refundOrder, setOrderStatus } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Pager } from '../../components/Pager';
import { useRemote } from '../../hooks/useRemote';
import { formatMoney } from '../../lib/money';
import { formatDate, PAYMENT_LABEL, STATUS_LABEL } from '../../lib/orderText';
import { RemoteView } from './RemoteView';

interface Action {
  key: string;
  label: string;
  destructive: boolean;
  run: (id: string) => Promise<unknown>;
}

const ACTIONS: Partial<Record<OrderStatus, Action[]>> = {
  PENDING_PAYMENT: [{ key: 'cancel', label: 'Cancel order', destructive: true, run: (id) => setOrderStatus(id, 'CANCELLED') }],
  PAID: [
    { key: 'ship', label: 'Mark shipped', destructive: false, run: (id) => setOrderStatus(id, 'SHIPPED') },
    { key: 'refund', label: 'Refund (simulated)', destructive: true, run: (id) => refundOrder(id) },
  ],
  SHIPPED: [{ key: 'deliver', label: 'Mark delivered', destructive: false, run: (id) => setOrderStatus(id, 'DELIVERED') }],
};

const FILTERS: (OrderStatus | '')[] = ['', 'PENDING_PAYMENT', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'EXPIRED'];

export function AdminOrders() {
  const { user } = useAuth();
  const canChange = user?.role === 'ADMIN'; // cosmetic: the API refuses everyone else regardless
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [reload, setReload] = useState(0);
  // Kept here, not in the row: reloading the list replaces the rows, and the message must survive that.
  const [problem, setProblem] = useState<string | null>(null);
  const loaded = useRemote((s) => getAdminOrders(page, status, s), `orders:${page}:${status}:${reload}`);

  return (
    <>
      <label className="field field--inline">
        <span>Status</span>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as OrderStatus | '');
            setPage(1);
          }}
        >
          {FILTERS.map((f) => (
            <option key={f || 'all'} value={f}>
              {f ? STATUS_LABEL[f] : 'All orders'}
            </option>
          ))}
        </select>
      </label>
      {problem && (
        <p className="notice notice--bad" role="alert">
          {problem}
        </p>
      )}
      <RemoteView state={loaded}>
        {(data) =>
          data.items.length === 0 ? (
            <p className="notice">No orders match.</p>
          ) : (
            <>
              <ul className="orders">
                {data.items.map((o) => (
                  <OrderRow key={o.id} order={o} canChange={canChange} onChanged={(message) => {
                      setProblem(message ?? null);
                      setReload((n) => n + 1);
                    }}
                  />
                ))}
              </ul>
              <Pager page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />
            </>
          )
        }
      </RemoteView>
    </>
  );
}

function OrderRow({ order, canChange, onChanged }: { order: AdminOrder; canChange: boolean; onChanged: (problem?: string) => void }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setConfirming(null);
  }, [order.status]);

  const actions = canChange ? (ACTIONS[order.status] ?? []) : [];
  const perform = async (action: Action) => {
    setBusy(true);
    let problem: string | undefined;
    try {
      await action.run(order.id);
    } catch (e) {
      problem = e instanceof Error ? e.message : 'Something went wrong';
    }
    setConfirming(null);
    setBusy(false);
    onChanged(problem); // always reload: show the order's real state even if someone else changed it first
  };

  return (
    <li className="admin-order">
      <div className="admin-order__head">
        <strong>Order {order.id.slice(-6).toUpperCase()}</strong>
        <span className="pill" data-status={order.status}>
          {STATUS_LABEL[order.status]}
        </span>
        <strong>{formatMoney(order.totalCents, order.currency)}</strong>
      </div>
      <p className="muted">
        {order.customer.displayName} · {order.customer.maskedEmail} · {formatDate(order.createdAt)}
      </p>
      <p className="muted">
        {order.items.map((i) => `${i.name} × ${i.quantity}`).join(', ')} · {PAYMENT_LABEL[order.paymentStatus]}
      </p>
      {actions.length > 0 && (
        <div className="admin-order__actions">
          {actions.map((a) =>
            confirming === a.key ? (
              <span key={a.key} className="confirm">
                <button type="button" className="btn btn--danger" disabled={busy} onClick={() => void perform(a)}>
                  {busy ? 'Working…' : `Confirm: ${a.label}`}
                </button>
                <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setConfirming(null)}>
                  Keep order
                </button>
              </span>
            ) : (
              <button
                key={a.key}
                type="button"
                className="btn btn--ghost"
                disabled={busy}
                onClick={() => (a.destructive ? setConfirming(a.key) : void perform(a))}
              >
                {a.label}
              </button>
            ),
          )}
        </div>
      )}
    </li>
  );
}
