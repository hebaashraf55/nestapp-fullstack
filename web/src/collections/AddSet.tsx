import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useCart } from '../cart/CartContext';

/** Adds several products in one server call. The server prices everything, including bundle savings. */
export function AddSet({ items, label }: { items: { productId: string; quantity: number }[]; label: string }) {
  const { user } = useAuth();
  const { addMany } = useCart();
  const [state, setState] = useState<{ phase: 'idle' | 'busy' | 'done' | 'error'; message?: string }>({ phase: 'idle' });
  if (user && user.role !== 'CUSTOMER') return null;
  const click = async () => {
    setState({ phase: 'busy' });
    try {
      await addMany(items);
      setState({ phase: 'done' });
    } catch (e) {
      setState({ phase: 'error', message: e instanceof Error ? e.message : 'Something went wrong' });
    }
  };
  return (
    <div className="add-set">
      <button type="button" className="btn btn--small" onClick={() => void click()} disabled={state.phase === 'busy' || items.length === 0}>
        {state.phase === 'busy' ? 'Adding…' : label}
      </button>
      <span role="status" aria-live="polite" className="small">
        {state.phase === 'done' && (
          <>
            Added. <Link to="/cart">View cart</Link>
          </>
        )}
        {state.phase === 'error' && <span className="error-text">{state.message}</span>}
      </span>
    </div>
  );
}
