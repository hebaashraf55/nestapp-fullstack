import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CARRIER_LABEL, type Order } from '../api/client';
import { formatMoney } from '../lib/money';
import { EVENT_LABEL, formatDate, formatRemaining, PAYMENT_LABEL, RETURN_LABEL, STATUS_LABEL } from '../lib/orderText';

const STEPS = ['PLACED', 'PAID', 'SHIPPED', 'DELIVERED'] as const;

export function Timeline({ order }: { order: Order }) {
  const events = order.timeline ?? [];
  const reached = new Set(events.map((e) => e.type));
  const stopped = order.status === 'CANCELLED' || order.status === 'EXPIRED';
  return (
    <section className="timeline" aria-labelledby="timeline-title">
      <h2 id="timeline-title">Tracking</h2>
      {!stopped && (
        <ol className="steps" aria-label="Progress">
          {STEPS.map((s) => (
            <li key={s} data-done={reached.has(s)} aria-current={events.at(-1)?.type === s ? 'step' : undefined}>
              <span className="steps__dot" aria-hidden="true" />
              {EVENT_LABEL[s]}
            </li>
          ))}
        </ol>
      )}
      <ol className="events">
        {[...events].reverse().map((e, i) => (
          <li key={`${e.type}-${i}`}>
            <strong>{EVENT_LABEL[e.type]}</strong>
            <span className="muted small">{formatDate(e.at)}</span>
            {e.note && <span className="muted small">{e.note}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ReturnForm({ onReturn }: { onReturn: (reason: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <button type="button" className="btn btn--ghost" onClick={() => setOpen(true)}>
        Request a return
      </button>
    );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 10) return setError('Tell us in a sentence what is wrong (at least 10 characters).');
    setBusy(true);
    setError(null);
    try {
      await onReturn(reason.trim());
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form return-form" onSubmit={submit} noValidate>
      <label className="field">
        <span>Why are you returning this order?</span>
        <textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="row-actions">
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Sending…' : 'Send return request'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <p className="muted small">Returns are accepted within 30 days of delivery. The refund is simulated: no money moves.</p>
    </form>
  );
}

export interface OrderActions {
  onPay: () => Promise<Order>;
  onCancel: () => Promise<Order>;
  onReturn?: (reason: string) => Promise<Order>;
  onReorder?: () => Promise<string>;
  /** Re-reads the order, so a failed action shows its real state (expired, paid elsewhere…). */
  onReload: () => Promise<Order>;
}

/** Everything about one order, for its owner (signed in) or a guest with the tracking link. */
export function OrderPanel({ initial, actions, title }: { initial: Order; actions: OrderActions; title?: string }) {
  const [order, setOrder] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setOrder(initial), [initial]);
  const pending = order.status === 'PENDING_PAYMENT';
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending]);
  const remaining = pending ? formatRemaining(new Date(order.expiresAt).getTime() - now) : '';

  const act = async (fn: () => Promise<Order>) => {
    setBusy(true);
    setError(null);
    try {
      setOrder(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      actions.onReload().then(setOrder).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page--narrow">
      <header className="page__head">
        <p className="eyebrow">
          {title ?? 'Order'} {order.id.slice(-6).toUpperCase()}
        </p>
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
          <button type="button" className="btn" onClick={() => void act(actions.onPay)} disabled={busy || !remaining}>
            {busy ? 'Processing…' : 'Simulate payment (no real charge)'}
          </button>
        </div>
      )}
      {order.status === 'EXPIRED' && (
        <p className="notice notice--bad">
          This order expired and its items were released. <Link to="/shop">Back to the shop</Link>
        </p>
      )}
      {order.returnRequest && (
        <p className="notice" role="status">
          <strong>{RETURN_LABEL[order.returnRequest.status]}</strong>
          {order.returnRequest.note && <> — “{order.returnRequest.note}”</>}
        </p>
      )}
      {error && (
        <p className="notice notice--bad" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}

      <div className="order-actions">
        {order.cancellable && (
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => {
              const paid = order.status === 'PAID';
              if (window.confirm(paid ? 'Cancel this order? It will be refunded (simulated).' : 'Cancel this order?'))
                void act(actions.onCancel);
            }}
          >
            Cancel order
          </button>
        )}
        {actions.onReorder && order.status !== 'PENDING_PAYMENT' && (
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => {
              setError(null);
              actions
                .onReorder!()
                .then(setMessage)
                .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong'));
            }}
          >
            Buy again
          </button>
        )}
        {order.returnable && actions.onReturn && (
          <ReturnForm
            onReturn={async (reason) => {
              setOrder(await actions.onReturn!(reason));
            }}
          />
        )}
      </div>

      <ul className="cart__lines">
        {order.items.map((item) => (
          <li key={item.productId} className="order-line">
            <span>
              <Link to={`/shop/${item.productId}`}>{item.name}</Link> × {item.quantity}
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
        {(order.bundleSavingsCents ?? 0) > 0 && (
          <div>
            <dt>Bundle savings</dt>
            <dd>−{formatMoney(order.bundleSavingsCents ?? 0, order.currency)}</dd>
          </div>
        )}
        {order.coupon && (
          <div>
            <dt>
              Coupon {order.coupon.code}
              {order.coupon.discountPercent ? ` (−${order.coupon.discountPercent}%)` : ''}
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
      {order.shipment && (
        <p className="notice">
          Shipped with <strong>{CARRIER_LABEL[order.shipment.carrier]}</strong>, tracking number{' '}
          <strong className="code">{order.shipment.trackingNumber}</strong>. The carrier is simulated: there is no real
          parcel to follow.
        </p>
      )}
      <Timeline order={order} />
    </div>
  );
}
