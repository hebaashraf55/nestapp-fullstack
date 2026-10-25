import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CartLine } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useCart } from '../cart/CartContext';
import { formatMoney } from '../lib/money';

const STATUS_TEXT: Record<CartLine['status'], string | null> = {
  ok: null,
  'out-of-stock': 'Sold out. Remove it to continue.',
  'insufficient-stock': 'Not enough in stock for this quantity.',
  unavailable: 'No longer available. Remove it to continue.',
};

export function Cart() {
  const { user } = useAuth();
  const { cart, status, error, setQuantity, remove, applyCode, reload } = useCart();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const readOnly = user?.role === 'DEMO_VIEWER';

  if (!user) {
    return (
      <div className="page">
        <h1 className="h1--small">Your cart</h1>
        <p className="notice">
          <Link to="/login" state={{ from: '/cart' }}>
            Sign in
          </Link>{' '}
          to see your cart.
        </p>
      </div>
    );
  }

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };
  const submitCoupon = (e: FormEvent) => {
    e.preventDefault();
    if (code.trim()) void act(async () => { await applyCode(code.trim()); setCode(''); });
  };

  return (
    <div className="page">
      <header className="page__head">
        <p className="eyebrow">Simulated checkout · nothing is purchased</p>
        <h1 className="h1--small">Your cart</h1>
      </header>

      {status === 'loading' && !cart && <p className="notice" aria-busy="true">Loading your cart…</p>}
      {status === 'error' && !cart && (
        <div className="notice notice--bad" role="alert">
          <strong>We couldn’t load your cart.</strong> {error}.{' '}
          <button type="button" className="link" onClick={reload}>
            Try again
          </button>
        </div>
      )}
      {readOnly && <p className="notice">The demo viewer account is read-only, so the cart cannot be changed.</p>}

      {cart && cart.items.length === 0 && (
        <div className="notice">
          <strong>Your cart is empty.</strong> <Link to="/shop">Browse the collection</Link>
        </div>
      )}

      {cart && cart.items.length > 0 && (
        <div className="cart">
          <ul className="cart__lines">
            {cart.items.map((line) => {
              const problem = STATUS_TEXT[line.status];
              return (
                <li key={line.productId} className="line" data-status={line.status}>
                  {line.image ? <img src={line.image} alt="" width="80" height="100" /> : <div className="line__ph" />}
                  <div className="line__main">
                    <h2>
                      {line.slug ? <Link to={`/shop/${line.productId}`}>{line.name}</Link> : 'Unavailable item'}
                    </h2>
                    {line.status !== 'unavailable' && (
                      <p className="line__price">{formatMoney(line.unitPriceCents, cart.currency)} each</p>
                    )}
                    {problem && <p className="error-text">{problem}</p>}
                  </div>
                  <div className="stepper" role="group" aria-label={`Quantity for ${line.name ?? 'unavailable item'}`}>
                    <button
                      type="button"
                      aria-label={`Decrease quantity of ${line.name ?? 'unavailable item'}`}
                      disabled={busy || readOnly || line.quantity <= 1}
                      onClick={() => void act(() => setQuantity(line.productId, line.quantity - 1))}
                    >
                      −
                    </button>
                    <output aria-live="polite">{line.quantity}</output>
                    <button
                      type="button"
                      aria-label={`Increase quantity of ${line.name ?? 'unavailable item'}`}
                      disabled={busy || readOnly || line.status === 'unavailable' || line.quantity >= 99}
                      onClick={() => void act(() => setQuantity(line.productId, line.quantity + 1))}
                    >
                      +
                    </button>
                  </div>
                  <p className="line__total">{formatMoney(line.lineTotalCents, cart.currency)}</p>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={busy || readOnly}
                    onClick={() => void act(() => remove(line.productId))}
                    aria-label={`Remove ${line.name ?? 'unavailable item'}`}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>

          <aside className="summary" aria-label="Order summary">
            <h2>Summary</h2>
            <dl>
              <div>
                <dt>Subtotal</dt>
                <dd>{formatMoney(cart.subtotalCents, cart.currency)}</dd>
              </div>
              {cart.coupon && (
                <div>
                  <dt>
                    Coupon {cart.coupon.code} (−{cart.coupon.discountPercent}%)
                  </dt>
                  <dd>−{formatMoney(cart.discountCents, cart.currency)}</dd>
                </div>
              )}
              <div className="summary__total">
                <dt>Total</dt>
                <dd>{formatMoney(cart.totalCents, cart.currency)}</dd>
              </div>
            </dl>
            {!readOnly && (
              <form className="coupon" onSubmit={submitCoupon}>
                <label className="field field--grow">
                  <span>Coupon code</span>
                  <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={64} autoComplete="off" />
                </label>
                <button type="submit" className="btn btn--ghost" disabled={busy || !code.trim()}>
                  Apply
                </button>
              </form>
            )}
            {cart.warnings.map((w) => (
              <p key={w} className="error-text" role="status">
                {w}
              </p>
            ))}
            {message && (
              <p className="error-text" role="alert">
                {message}
              </p>
            )}
            {!readOnly && (
              <Link to="/checkout" className={`btn btn--block${cart.hasIssues ? ' btn--disabled' : ''}`} aria-disabled={cart.hasIssues}>
                Continue to simulated checkout
              </Link>
            )}
            <p className="notice">
              Checkout is simulated. No payment is taken and no card details are collected.
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}
