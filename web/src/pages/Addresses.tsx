import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  type AddressFields,
  createAddress,
  deleteAddress,
  formatAddress,
  getAddresses,
  type SavedAddress,
  setDefaultAddress,
  updateAddress,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useRemote } from '../hooks/useRemote';

const EMPTY: AddressFields = { label: '', fullName: '', line1: '', line2: '', city: '', postalCode: '', country: '', phone: '' };
const LABELS: [keyof AddressFields, string, number, boolean][] = [
  ['label', 'Label (Home, Studio…)', 40, false],
  ['fullName', 'Full name', 80, true],
  ['line1', 'Street and number', 120, true],
  ['line2', 'Apartment, floor (optional)', 120, false],
  ['postalCode', 'Postal code', 20, true],
  ['city', 'City', 80, true],
  ['country', 'Country', 56, true],
  ['phone', 'Phone number', 24, true],
];

function AddressForm({ initial, onSave, onCancel }: { initial: AddressFields; onSave: (f: AddressFields) => Promise<void>; onCancel?: () => void }) {
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const missing = LABELS.find(([k, , , req]) => req && !f[k].trim());
    if (missing) return setError(`Fill in “${missing[1]}”.`);
    setBusy(true);
    setError(null);
    try {
      await onSave(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()])) as unknown as AddressFields);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form address-form" onSubmit={submit} noValidate>
      {LABELS.map(([k, label, max]) => (
        <label key={k} className="field">
          <span>{label}</span>
          <input value={f[k]} maxLength={max} type={k === 'phone' ? 'tel' : 'text'} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
        </label>
      ))}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="row-actions">
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Saving…' : 'Save address'}
        </button>
        {onCancel && (
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export function Addresses() {
  const { user } = useAuth();
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useRemote((s) => (user?.role === 'CUSTOMER' ? getAddresses(s) : Promise.resolve([] as SavedAddress[])), `addr:${version}:${user?.id ?? ''}`);
  if (user?.role !== 'CUSTOMER')
    return (
      <div className="page">
        <p className="notice">
          {user ? 'The address book is for customer accounts.' : <><Link to="/login" state={{ from: '/account/addresses' }}>Sign in</Link> to manage your addresses.</>}
        </p>
      </div>
    );
  const refresh = () => {
    setEditing(null);
    setVersion((v) => v + 1);
  };
  const act = (fn: () => Promise<unknown>) => {
    setError(null);
    fn()
      .then(refresh)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong'));
  };
  return (
    <div className="page page--narrow">
      <header className="page__head">
        <p className="eyebrow">Your account</p>
        <h1 className="h1--small">Addresses</h1>
        <p className="lede lede--small">Saved addresses appear at checkout. The default is chosen automatically.</p>
      </header>
      {error && (
        <p className="notice notice--bad" role="alert">
          {error}
        </p>
      )}
      {list.phase === 'ready' && (
        <ul className="address-list">
          {list.data.map((a) => (
            <li key={a.id} className="card-row">
              {editing === a.id ? (
                <AddressForm initial={a} onCancel={() => setEditing(null)} onSave={async (f) => {
                  await updateAddress(a.id, f);
                  refresh();
                }} />
              ) : (
                <>
                  <div>
                    <h3>
                      {a.label || a.fullName} {a.isDefault && <span className="pill">default</span>}
                    </h3>
                    <p className="muted small">
                      {formatAddress(a)} · {a.phone}
                    </p>
                  </div>
                  <div className="moderation__actions">
                    {!a.isDefault && (
                      <button type="button" className="btn btn--ghost btn--small" onClick={() => act(() => setDefaultAddress(a.id))}>
                        Make default
                      </button>
                    )}
                    <button type="button" className="btn btn--ghost btn--small" onClick={() => setEditing(a.id)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn--danger btn--small"
                      onClick={() => {
                        if (window.confirm('Delete this address?')) act(() => deleteAddress(a.id));
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {list.phase === 'ready' && list.data.length === 0 && editing !== 'new' && <p className="notice">No saved addresses yet.</p>}
      {editing === 'new' ? (
        <AddressForm initial={EMPTY} onCancel={() => setEditing(null)} onSave={async (f) => {
          await createAddress(f);
          refresh();
        }} />
      ) : (
        <button type="button" className="btn" onClick={() => setEditing('new')}>
          Add an address
        </button>
      )}
    </div>
  );
}
