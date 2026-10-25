import { Link } from 'react-router-dom';
import { getOrders } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useRemote } from '../hooks/useRemote';
import { formatMoney } from '../lib/money';
import { formatDate, STATUS_LABEL } from '../lib/orderText';

export function Orders() {
  const { user } = useAuth();
  const orders = useRemote((s) => (user ? getOrders(s) : Promise.resolve([])), user?.id ?? 'anon');

  if (!user) {
    return (
      <div className="page">
        <h1 className="h1--small">Your orders</h1>
        <p className="notice">
          <Link to="/login" state={{ from: '/orders' }}>
            Sign in
          </Link>{' '}
          to see your orders.
        </p>
      </div>
    );
  }
  return (
    <div className="page">
      <header className="page__head">
        <p className="eyebrow">Simulated orders · no payment is ever taken</p>
        <h1 className="h1--small">Your orders</h1>
      </header>
      {orders.phase === 'loading' && <p className="notice" aria-busy="true">Loading your orders…</p>}
      {orders.phase === 'error' && (
        <p className="notice notice--bad" role="alert">
          We couldn’t load your orders. {orders.error.message}
        </p>
      )}
      {orders.phase === 'ready' && orders.data.length === 0 && (
        <p className="notice">
          <strong>No orders yet.</strong> <Link to="/shop">Browse the collection</Link>
        </p>
      )}
      {orders.phase === 'ready' && orders.data.length > 0 && (
        <ul className="orders">
          {orders.data.map((o) => (
            <li key={o.id} className="order-row">
              <div>
                <Link to={`/orders/${o.id}`}>Order {o.id.slice(-6).toUpperCase()}</Link>
                <p className="muted">{formatDate(o.createdAt)}</p>
              </div>
              <span className="pill" data-status={o.status}>
                {STATUS_LABEL[o.status]}
              </span>
              <strong>{formatMoney(o.totalCents, o.currency)}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
