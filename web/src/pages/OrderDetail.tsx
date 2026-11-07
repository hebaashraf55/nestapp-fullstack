import { Link, useParams } from 'react-router-dom';
import { ApiError, cancelOrder, getOrder, reorder, requestReturn, simulatePayment } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useCart } from '../cart/CartContext';
import { useRemote } from '../hooks/useRemote';
import { OrderPanel } from '../orders/OrderPanel';

export function OrderDetail() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { reload } = useCart();
  const loaded = useRemote(
    (s) => (user ? getOrder(id, s) : Promise.reject(new ApiError(401, 'Sign in to see this order'))),
    `${id}:${user?.id ?? ''}`,
  );

  if (!user) {
    return (
      <div className="page">
        <p className="notice">
          <Link to="/login" state={{ from: `/orders/${id}` }}>
            Sign in
          </Link>{' '}
          to see this order. Guest orders are opened with the tracking link from the confirmation email.
        </p>
      </div>
    );
  }
  if (loaded.phase === 'loading') {
    return (
      <div className="page" aria-busy="true">
        <p className="notice">Loading your order…</p>
      </div>
    );
  }
  if (loaded.phase === 'error') {
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
  const customer = user.role === 'CUSTOMER';
  return (
    <>
      <OrderPanel
        initial={loaded.data}
        actions={{
          onPay: () => simulatePayment(id),
          onReload: () => getOrder(id),
          onCancel: () => cancelOrder(id),
          onReturn: customer ? (reason) => requestReturn(id, reason) : undefined,
          onReorder: customer
            ? async () => {
                const r = await reorder(id);
                reload();
                const skipped = r.skipped.map((s) => `${s.name ?? 'an item'} (${s.reason})`).join(', ');
                return `${r.added} ${r.added === 1 ? 'item' : 'items'} added to your cart at today’s prices.${skipped ? ` Not added: ${skipped}.` : ''}`;
              }
            : undefined,
        }}
      />
      <p className="page page--narrow page--flush">
        <Link to="/orders">All orders</Link>
      </p>
    </>
  );
}
