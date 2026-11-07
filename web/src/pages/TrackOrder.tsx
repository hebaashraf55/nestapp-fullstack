import { type FormEvent, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError, type Order, trackCancel, trackOrder, trackPay } from '../api/client';
import { OrderPanel } from '../orders/OrderPanel';

/**
 * Guest order tracking. The link is /track/<order>#<code>: the code after # never leaves the browser
 * in a URL, it is sent only in the body of POST /api/order/track.
 */
export function TrackOrder() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const token = location.hash.replace(/^#/, '');
  const justPlaced = (location.state as { justPlaced?: boolean } | null)?.justPlaced === true;
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orderInput, setOrderInput] = useState(id);
  const [codeInput, setCodeInput] = useState('');

  useEffect(() => {
    setOrder(null);
    setError(null);
    if (!id || !/^[0-9a-f]{32}$/.test(token)) return;
    trackOrder(id, token)
      .then(setOrder)
      .catch((e: unknown) =>
        setError(
          e instanceof ApiError && e.statusCode === 404
            ? 'We couldn’t find an order with that number and tracking code.'
            : e instanceof Error
              ? e.message
              : 'Something went wrong',
        ),
      );
  }, [id, token]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const o = orderInput.trim().toLowerCase();
    const c = codeInput.trim().toLowerCase();
    if (!/^[0-9a-f]{24}$/.test(o) || !/^[0-9a-f]{32}$/.test(c)) {
      setError('Enter the order number and the tracking code exactly as they appear in your email.');
      return;
    }
    navigate(`/track/${o}#${c}`);
  };

  if (order)
    return (
      <>
        {justPlaced && (
          <div className="page page--narrow page--flush">
            <p className="notice" role="status">
              <strong>Order placed.</strong> Keep this page’s link: it is the only way to see a guest order. We also
              emailed it to {order.guestEmail}.
            </p>
          </div>
        )}
        <OrderPanel
          title="Guest order"
          initial={order}
          actions={{
            onPay: () => trackPay(order.id, token),
            onCancel: () => trackCancel(order.id, token),
            onReload: () => trackOrder(order.id, token),
          }}
        />
      </>
    );

  return (
    <div className="page page--narrow">
      <header className="page__head">
        <p className="eyebrow">Guest orders</p>
        <h1 className="h1--small">Track an order</h1>
        <p className="lede lede--small">Open the link in your confirmation email, or enter its order number and tracking code.</p>
      </header>
      {error && (
        <p className="notice notice--bad" role="alert">
          {error}
        </p>
      )}
      <form className="form" onSubmit={submit} noValidate>
        <label className="field">
          <span>Order number</span>
          <input value={orderInput} onChange={(e) => setOrderInput(e.target.value)} maxLength={24} autoComplete="off" />
        </label>
        <label className="field">
          <span>Tracking code</span>
          <input value={codeInput} onChange={(e) => setCodeInput(e.target.value)} maxLength={32} autoComplete="off" />
        </label>
        <button type="submit" className="btn">
          Track order
        </button>
      </form>
    </div>
  );
}
