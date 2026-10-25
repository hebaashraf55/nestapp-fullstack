import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { Product } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useCart } from '../cart/CartContext';

/** The server decides everything about price and stock; this only sends a product id and a quantity. */
export function AddToCart({ product }: { product: Product }) {
  const { user } = useAuth();
  const { add } = useCart();
  const location = useLocation();
  const [quantity, setQuantity] = useState(1);
  const [state, setState] = useState<{ phase: 'idle' | 'busy' | 'done' | 'error'; message?: string }>({ phase: 'idle' });

  if (!product.inStock) return <p className="notice">This piece is sold out.</p>;
  if (!user) {
    return (
      <p className="notice">
        <Link to="/login" state={{ from: location.pathname }}>
          Sign in
        </Link>{' '}
        to add this to your cart.
      </p>
    );
  }
  if (user.role === 'DEMO_VIEWER') {
    return <p className="notice">The demo viewer account is read-only, so it cannot add to a cart.</p>;
  }

  const max = Math.min(product.stock, 10);
  const submit = async () => {
    setState({ phase: 'busy' });
    try {
      await add(product.id, quantity);
      setState({ phase: 'done' });
    } catch (error) {
      setState({ phase: 'error', message: error instanceof Error ? error.message : 'Something went wrong' });
    }
  };

  return (
    <div className="buy">
      <label className="field field--narrow">
        <span>Quantity</span>
        <select value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} disabled={state.phase === 'busy'}>
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn" onClick={submit} disabled={state.phase === 'busy'}>
        {state.phase === 'busy' ? 'Adding…' : 'Add to cart'}
      </button>
      <p className="buy__status" role="status" aria-live="polite">
        {state.phase === 'done' && (
          <>
            Added. <Link to="/cart">View cart</Link>
          </>
        )}
        {state.phase === 'error' && <span className="error-text">{state.message}</span>}
      </p>
    </div>
  );
}
