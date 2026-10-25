import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createOrder } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useCart } from '../cart/CartContext';
import { formatMoney } from '../lib/money';

/** Collects only a delivery address and phone number. There is deliberately no payment field. */
export function Checkout() {
  const { user } = useAuth();
  const { cart, status, reload } = useCart();
  const navigate = useNavigate();
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) {
    return (
      <div className="page">
        <h1 className="h1--small">Checkout</h1>
        <p className="notice">
          <Link to="/login" state={{ from: '/checkout' }}>
            Sign in
          </Link>{' '}
          to place an order.
        </p>
      </div>
    );
  }
  if (user.role === 'DEMO_VIEWER') {
    return (
      <div className="page">
        <h1 className="h1--small">Checkout</h1>
        <p className="notice">The demo viewer account is read-only, so it cannot place orders.</p>
      </div>
    );
  }
  if (status === 'loading' && !cart) {
    return (
      <div className="page" aria-busy="true">
        <p className="notice">Loading your cart…</p>
      </div>
    );
  }
  if (!cart || cart.items.length === 0) {
    return (
      <div className="page">
        <h1 className="h1--small">Checkout</h1>
        <p className="notice">
          <strong>Your cart is empty.</strong> <Link to="/shop">Browse the collection</Link>
        </p>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const order = await createOrder(address.trim(), phone.trim());
      reload(); // the server emptied the cart
      navigate(`/orders/${order.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  };

  return (
    <div className="page page--narrow">
      <header className="page__head">
        <p className="eyebrow">Simulated checkout · nothing is purchased</p>
        <h1 className="h1--small">Checkout</h1>
      </header>
      <p className="notice">
        This is a portfolio demo. Placing an order reserves stock for 30 minutes. You then “pay” with one click;
        no payment is taken and no card details are collected.
      </p>
      <p className="checkout__total">
        {cart.itemCount} {cart.itemCount === 1 ? 'item' : 'items'} · <strong>{formatMoney(cart.totalCents, cart.currency)}</strong>
        {cart.coupon && <span> (coupon {cart.coupon.code} applied)</span>}
      </p>
      {cart.hasIssues && (
        <p className="notice notice--bad" role="alert">
          Some items are unavailable or out of stock. <Link to="/cart">Review your cart</Link> first.
        </p>
      )}
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Delivery address</span>
          <input value={address} onChange={(e) => setAddress(e.target.value)} required minLength={5} maxLength={200} autoComplete="street-address" />
        </label>
        <label className="field">
          <span>Phone number</span>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required maxLength={24} autoComplete="tel" />
        </label>
        {error && (
          <p className="notice notice--bad" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn" disabled={busy || cart.hasIssues}>
          {busy ? 'Placing order…' : 'Place order (simulated)'}
        </button>
      </form>
    </div>
  );
}
