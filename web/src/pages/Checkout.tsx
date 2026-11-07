import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  createAddress,
  createOrder,
  createOrderFromAddress,
  formatAddress,
  getAddresses,
  placeGuestOrder,
  type SavedAddress,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useCart } from '../cart/CartContext';
import { formatMoney } from '../lib/money';

const EMPTY_ADDRESS = { label: '', fullName: '', line1: '', line2: '', city: '', postalCode: '', country: '', phone: '' };

/** Collects only delivery details (and a guest's email). There is deliberately no payment field. */
export function Checkout() {
  const { user } = useAuth();
  const { cart, status, reload, isGuest, guestLines, clearGuest } = useCart();
  const navigate = useNavigate();
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [saved, setSaved] = useState<SavedAddress[] | null>(null);
  const [choice, setChoice] = useState<string>('new');
  const [draft, setDraft] = useState(EMPTY_ADDRESS);
  const [save, setSave] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customer = user?.role === 'CUSTOMER';

  useEffect(() => {
    if (!customer) return;
    getAddresses()
      .then((list) => {
        setSaved(list);
        const preferred = list.find((a) => a.isDefault) ?? list[0];
        if (preferred) setChoice(preferred.id);
      })
      .catch(() => setSaved([]));
  }, [customer]);

  if (user && !customer) {
    return (
      <div className="page">
        <h1 className="h1--small">Checkout</h1>
        <p className="notice">
          {user.role === 'DEMO_VIEWER'
            ? 'The demo viewer account is read-only, so it cannot place orders.'
            : 'Staff accounts do not place orders. Sign out to shop as a visitor.'}
        </p>
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

  const field = (k: keyof typeof EMPTY_ADDRESS) => ({
    value: draft[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [k]: e.target.value }),
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isGuest) {
        const result = await placeGuestOrder({ email: email.trim(), items: guestLines, address: address.trim(), phone: phone.trim() });
        clearGuest();
        // The tracking code stays after # so it is never sent to a server in a URL.
        navigate(result.trackPath, { replace: true, state: { justPlaced: true } });
        return;
      }
      let order;
      if (choice !== 'new') {
        order = await createOrderFromAddress(choice);
      } else {
        const fields = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v.trim()])) as typeof draft;
        if (save) {
          const created = await createAddress(fields);
          order = await createOrderFromAddress(created.id);
        } else {
          order = await createOrder(formatAddress(fields), fields.phone.trim());
        }
      }
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
        {(cart.bundleSavingsCents ?? 0) > 0 && <span> (sets save {formatMoney(cart.bundleSavingsCents ?? 0, cart.currency)})</span>}
        {cart.coupon && <span> (coupon {cart.coupon.code} applied)</span>}
      </p>
      {cart.hasIssues && (
        <p className="notice notice--bad" role="alert">
          Some items are unavailable or out of stock. <Link to="/cart">Review your cart</Link> first.
        </p>
      )}
      <form className="form" onSubmit={submit}>
        {isGuest ? (
          <>
            <p className="muted">
              Checking out as a guest.{' '}
              <Link to="/login" state={{ from: '/checkout' }}>
                Sign in
              </Link>{' '}
              to use saved addresses and see your orders later.
            </p>
            <label className="field">
              <span>Email for the confirmation and tracking link</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="email" />
            </label>
            <label className="field">
              <span>Delivery address</span>
              <input value={address} onChange={(e) => setAddress(e.target.value)} required minLength={5} maxLength={200} autoComplete="street-address" />
            </label>
            <label className="field">
              <span>Phone number</span>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required maxLength={24} autoComplete="tel" />
            </label>
          </>
        ) : (
          <fieldset className="address-choice">
            <legend>Deliver to</legend>
            {saved === null && <p className="muted small">Loading your addresses…</p>}
            {saved?.map((a) => (
              <label key={a.id} className="radio-card">
                <input type="radio" name="address" value={a.id} checked={choice === a.id} onChange={() => setChoice(a.id)} />
                <span>
                  <strong>{a.label || a.fullName}</strong>
                  {a.isDefault && <span className="muted small"> · default</span>}
                  <br />
                  <span className="muted small">
                    {formatAddress(a)} · {a.phone}
                  </span>
                </span>
              </label>
            ))}
            <label className="radio-card">
              <input type="radio" name="address" value="new" checked={choice === 'new'} onChange={() => setChoice('new')} />
              <span>
                <strong>A new address</strong>
              </span>
            </label>
            {choice === 'new' && (
              <div className="address-form">
                <label className="field">
                  <span>Full name</span>
                  <input {...field('fullName')} required maxLength={80} autoComplete="name" />
                </label>
                <label className="field">
                  <span>Street and number</span>
                  <input {...field('line1')} required maxLength={120} autoComplete="address-line1" />
                </label>
                <label className="field">
                  <span>Apartment, floor (optional)</span>
                  <input {...field('line2')} maxLength={120} autoComplete="address-line2" />
                </label>
                <div className="form__row">
                  <label className="field">
                    <span>Postal code</span>
                    <input {...field('postalCode')} required maxLength={20} autoComplete="postal-code" />
                  </label>
                  <label className="field">
                    <span>City</span>
                    <input {...field('city')} required maxLength={80} autoComplete="address-level2" />
                  </label>
                </div>
                <div className="form__row">
                  <label className="field">
                    <span>Country</span>
                    <input {...field('country')} required maxLength={56} autoComplete="country-name" />
                  </label>
                  <label className="field">
                    <span>Phone number</span>
                    <input type="tel" {...field('phone')} required maxLength={24} autoComplete="tel" />
                  </label>
                </div>
                <label className="check">
                  <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
                  Save to my address book
                </label>
              </div>
            )}
          </fieldset>
        )}
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
