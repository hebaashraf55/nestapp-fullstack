import { type FormEvent, useState } from 'react';
import { createBundle, deleteBundle, getBundles, type Bundle, type Product, updateBundle } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useRemote } from '../../hooks/useRemote';
import { formatMoney } from '../../lib/money';
import { ProductPicker } from './ProductPicker';
import { RemoteView } from './RemoteView';

interface Line {
  product: Pick<Product, 'id' | 'name'>;
  quantity: number;
}

function BundleForm({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [discount, setDiscount] = useState('10');
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const pct = Number(discount);
    if (name.trim().length < 3) return setError('Give the set a name of at least 3 characters.');
    if (lines.length < 2 || lines.length > 6) return setError('A set needs 2 to 6 different products.');
    if (!Number.isInteger(pct) || pct < 1 || pct > 50) return setError('Use a whole-number discount from 1 to 50 %.');
    setBusy(true);
    setError(null);
    try {
      await createBundle({
        name: name.trim(),
        description: description.trim(),
        image: null,
        items: lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
        discountPercent: pct,
        active: true,
      });
      setName('');
      setDescription('');
      setLines([]);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form card-row card-row--stack" onSubmit={submit} noValidate>
      <h2>New set</h2>
      <div className="form__row">
        <label className="field">
          <span>Name</span>
          <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field field--narrow">
          <span>Discount %</span>
          <input type="number" min={1} max={50} value={discount} onChange={(e) => setDiscount(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>Description</span>
        <input value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <ul className="picked" aria-label="Products in this set">
        {lines.map((l, i) => (
          <li key={l.product.id}>
            <span>{l.product.name}</span>
            <label>
              <span className="sr-only">Quantity of {l.product.name}</span>
              <select value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    × {n}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="link" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      {lines.length < 6 && (
        <ProductPicker exclude={lines.map((l) => l.product.id)} onPick={(p) => setLines([...lines, { product: p, quantity: 1 }])} />
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn" disabled={busy}>
        {busy ? 'Saving…' : 'Create set'}
      </button>
      <p className="muted small">Prices are never entered here: the server prices each set from today’s sale prices.</p>
    </form>
  );
}

export function AdminBundles() {
  const { user } = useAuth();
  const admin = user?.role === 'ADMIN';
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const bundles = useRemote((s) => getBundles({ all: admin }, s), `admin-bundles:${version}`);
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
  };
  return (
    <>
      {error && (
        <p className="notice notice--bad" role="alert">
          {error}
        </p>
      )}
      <RemoteView state={bundles}>
        {(list: Bundle[]) =>
          list.length === 0 ? (
            <p className="notice">No sets yet.</p>
          ) : (
            <ul className="moderation">
              {list.map((b) => (
                <li key={b.id} className="card-row">
                  <div>
                    <h3>{b.name}</h3>
                    <p className="muted small">
                      {b.items.map((i) => `${i.quantity > 1 ? `${i.quantity} × ` : ''}${i.product?.name ?? 'removed product'}`).join(' · ')}
                    </p>
                    <p className="small">
                      −{b.discountPercent}% · {formatMoney(b.priceCents)} instead of {formatMoney(b.itemsTotalCents)}
                      {!b.available && ' · not all in stock'}
                    </p>
                  </div>
                  <div className="moderation__actions">
                    <span className="pill" data-status={b.active ? 'APPROVED' : 'REJECTED'}>
                      {b.active ? 'active' : 'paused'}
                    </span>
                    {admin && (
                      <>
                        <button type="button" className="btn btn--ghost btn--small" onClick={() => void act(() => updateBundle(b.id, { active: !b.active }))}>
                          {b.active ? 'Pause' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          className="btn btn--danger btn--small"
                          onClick={() => {
                            if (window.confirm(`Delete the set “${b.name}”?`)) void act(() => deleteBundle(b.id));
                          }}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </RemoteView>
      {admin && <BundleForm onSaved={() => setVersion((v) => v + 1)} />}
    </>
  );
}
