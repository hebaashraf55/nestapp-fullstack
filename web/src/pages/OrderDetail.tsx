import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, getOrder, type Order, simulatePayment } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useRemote } from '../hooks/useRemote';
import { formatMoney } from '../lib/money';
import { formatDate, formatRemaining, PAYMENT_LABEL, STATUS_LABEL } from '../lib/orderText';

export function OrderDetail() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const loaded = useRemote((s) => (user ? getOrder(id, s) : Promise.reject(new ApiError(401, 'Sign in to see this order'))), `${id}:${user?.id ?? ''}`);
  const [order, setOrder] = useState<Order | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loaded.phase === 'ready') setOrder(loaded.data);
  }, [loaded]);

  const pending = order?.status === 'PENDING_PAYMENT';
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending]);

  if (!user) {
    return (
      <div className="page">
        <p className="notice">
          <Link to="/login" state={{ from: `/orders/${id}` }}>
            Sign in
          </Link>{' '}
          to see this order.
        </p>
      </div>
    );
  }
  if (loaded.phase === 'loading' && !order) {
    return (
      <div className="page" aria-busy="true">
        <p className="notice">Loading your order…</p>
      </div>
    );
  }
  if (loaded.phase === 'error' && !order) {
    const missing = loaded.error instanceof ApiError && [400, 404].includes(loaded.error.statusCode);
    return (
      <div className="page">
        <p className="notice notice--bad" role="alert">
          <strong>{missing ? 'We couldn’t find that order.' : 'We couldn’t load this order.'}</strong>{' '}
          {missing ? '' : loaded.error.message} <Link to="/orders">Back to your orders</Link>
        </p>
      </div>
    );
  }
  if (!order) return null;

  const remaining = pending ? formatRemaining(new Date(order.expiresAt).getTime() - now) : '';
  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      setOrder(await simulatePayment(order.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      // The order may have expired or been paid elsewhere: show its real state.
      getOrder(order.id).then(setOrder).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page--narrow">
      <header className="page__head">
        <p className="eyebrow">Order {order.id.slice(-6).toUpperCase()}</p>
        <h1 className="h1--small">{STATUS_LABEL[order.status]}</h1>
        <p className="muted">
          Placed {formatDate(order.createdAt)} · {PAYMENT_LABEL[order.paymentStatus]}
        </p>
      </header>

      <p className="notice">{order.payment.notice}</p>

      {pending && (
        <div className="pay" role="region" aria-label="Simulated payment">
          {remaining ? (
            <p>
              Your items are held for <strong>{remaining}</strong>.
            </p>
          ) : (
            <p className="error-text">The hold has run out. Refresh to see the order’s final state.</p>
          )}
          <button type="button" className="btn" onClick={() => void pay()} disabled={busy || !remaining}>
            {busy ? 'Processing…' : 'Simulate payment (no real charge)'}
          </button>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
      {order.status === 'EXPIRED' && <p className="notice notice--bad">This order expired and its items were released. <Link to="/shop">Back to the shop</Link></p>}

      <ul className="cart__lines">
        {order.items.map((item) => (
          <li key={item.productId} className="order-line">
            <span>
              {item.name} × {item.quantity}
            </span>
            <strong>{formatMoney(item.lineTotalCents, order.currency)}</strong>
          </li>
        ))}
      </ul>
      <dl className="order-totals">
        <div>
          <dt>Subtotal</dt>
          <dd>{formatMoney(order.subtotalCents, order.currency)}</dd>
        </div>
        {order.coupon && (
          <div>
            <dt>
              Coupon {order.coupon.code} (−{order.coupon.discountPercent}%)
            </dt>
            <dd>−{formatMoney(order.discountCents, order.currency)}</dd>
          </div>
        )}
        <div className="summary__total">
          <dt>Total</dt>
          <dd>{formatMoney(order.totalCents, order.currency)}</dd>
        </div>
      </dl>
      <p className="muted">
        Delivering to {order.address} · {order.phone}
      </p>
      <p>
        <Link to="/orders">All orders</Link>
      </p>
    </div>
  );
}
