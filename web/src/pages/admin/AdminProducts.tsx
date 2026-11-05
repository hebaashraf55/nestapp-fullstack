import { type FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { adjustProductStock, deleteProduct, getCategories, getProducts, type Product } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Pager } from '../../components/Pager';
import { useRemote } from '../../hooks/useRemote';
import { formatMoney } from '../../lib/money';
import { RemoteView } from './RemoteView';

/** Same threshold as the dashboard's "Low stock" tile. */
export const LOW_STOCK_AT = 5;

type StockFilter = '' | 'true' | 'false';

export function stockState(stock: number): { key: 'SOLD_OUT' | 'LOW' | 'IN_STOCK'; label: string } {
  if (stock <= 0) return { key: 'SOLD_OUT', label: 'Sold out' };
  if (stock <= LOW_STOCK_AT) return { key: 'LOW', label: 'Low stock' };
  return { key: 'IN_STOCK', label: 'In stock' };
}

export function AdminProducts() {
  const { user } = useAuth();
  const canChange = user?.role === 'ADMIN'; // cosmetic: the API refuses everyone else regardless
  const location = useLocation();
  const navigate = useNavigate();
  const flash = (location.state as { saved?: string } | null)?.saved ?? null;

  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [inStock, setInStock] = useState<StockFilter>('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const categories = useRemote((s) => getCategories(s), 'admin-categories');
  const loaded = useRemote(
    (s) =>
      getProducts(
        { q: q || undefined, categoryId: categoryId || undefined, inStock: inStock === '' ? undefined : inStock === 'true', sort: 'name', page, limit: 10 },
        s,
      ),
    `admin-products:${q}:${categoryId}:${inStock}:${page}:${reload}`,
  );

  const search = (e: FormEvent) => {
    e.preventDefault();
    setQ(draft.trim());
    setPage(1);
  };
  const changed = (text: string, ok = true, reloadList = true) => {
    setMessage({ ok, text });
    if (flash) navigate(location.pathname, { replace: true, state: null }); // drop the old flash
    if (reloadList) setReload((n) => n + 1);
  };

  return (
    <>
      <div className="admin-toolbar">
        <form className="admin-filters" role="search" onSubmit={search}>
          <label className="field field--grow">
            <span>Search</span>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Product name" maxLength={80} />
          </label>
          <label className="field">
            <span>Category</span>
            <select
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All categories</option>
              {categories.phase === 'ready' &&
                categories.data.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            <span>Stock</span>
            <select
              value={inStock}
              onChange={(e) => {
                setInStock(e.target.value as StockFilter);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="true">In stock</option>
              <option value="false">Sold out</option>
            </select>
          </label>
          <button type="submit" className="btn btn--ghost">
            Search
          </button>
        </form>
        {canChange && (
          <Link to="/admin/products/new" className="btn">
            New product
          </Link>
        )}
      </div>

      {(message ?? (flash ? { ok: true, text: flash } : null)) && (
        <p
          className={`notice${message && !message.ok ? ' notice--bad' : ''}`}
          role={message && !message.ok ? 'alert' : 'status'}
        >
          {message?.text ?? flash}
        </p>
      )}

      <RemoteView state={loaded}>
        {(data) =>
          data.items.length === 0 ? (
            <p className="notice">No products match.</p>
          ) : (
            <>
              <div className="table-wrap">
                <table className="table table--admin">
                  <caption className="sr-only">Products</caption>
                  <thead>
                    <tr>
                      <th scope="col">Product</th>
                      <th scope="col">Category</th>
                      <th scope="col">Price</th>
                      <th scope="col">Stock</th>
                      <th scope="col">Status</th>
                      {canChange && <th scope="col"><span className="sr-only">Actions</span></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((p) => (
                      <ProductRow key={p.id} product={p} canChange={canChange} onChanged={changed} />
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />
            </>
          )
        }
      </RemoteView>
    </>
  );
}

function ProductRow({
  product: p,
  canChange,
  onChanged,
}: {
  product: Product;
  canChange: boolean;
  onChanged: (text: string, ok?: boolean, reloadList?: boolean) => void;
}) {
  const [mode, setMode] = useState<'idle' | 'stock' | 'delete'>('idle');
  const [change, setChange] = useState('');
  const [busy, setBusy] = useState(false);
  const state = stockState(p.stock);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      onChanged(success);
    } catch (e) {
      onChanged(e instanceof Error ? e.message : 'Something went wrong', false);
    }
    setBusy(false);
    setMode('idle');
    setChange('');
  };

  const submitStock = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(change);
    if (!Number.isInteger(n) || n === 0) {
      onChanged('Enter a whole number other than 0, for example 5 to add or -2 to remove.', false, false);
      return;
    }
    if (p.stock + n < 0) {
      onChanged(`${p.name} has ${p.stock} in stock; you can remove at most ${p.stock}.`, false, false);
      return;
    }
    void run(() => adjustProductStock(p.id, n), `${p.name}: stock ${n > 0 ? 'increased' : 'reduced'} by ${Math.abs(n)}.`);
  };

  return (
    <tr>
      <td>
        <div className="table-product">
          {p.images[0] && <img src={p.images[0]} alt="" width="48" height="60" loading="lazy" />}
          <div>
            <strong>{p.name}</strong>
            <span className="muted">{p.brand?.name ?? '—'}</span>
          </div>
        </div>
      </td>
      <td>{p.category?.name ?? '—'}</td>
      <td className="nowrap">
        {formatMoney(p.salePriceCents, p.currency)}
        {p.discountPercent > 0 && (
          <span className="muted">
            <s>{formatMoney(p.priceCents, p.currency)}</s> −{p.discountPercent}%
          </span>
        )}
      </td>
      <td className="num">{p.stock}</td>
      <td>
        <span className="pill" data-status={state.key}>
          {state.label}
        </span>
      </td>
      {canChange && (
        <td>
          {mode === 'idle' && (
            <div className="row-actions">
              <Link to={`/admin/products/${p.id}`} className="btn btn--ghost btn--small">
                Edit
              </Link>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => setMode('stock')}>
                Stock
              </button>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => setMode('delete')}>
                Delete
              </button>
            </div>
          )}
          {mode === 'stock' && (
            <form className="row-actions" onSubmit={submitStock}>
              <label className="field field--compact">
                <span className="sr-only">Change stock of {p.name} by</span>
                <input
                  type="number"
                  step={1}
                  inputMode="numeric"
                  value={change}
                  onChange={(e) => setChange(e.target.value)}
                  placeholder="+5 or -2"
                  autoFocus
                  required
                />
              </label>
              <button type="submit" className="btn btn--small" disabled={busy}>
                {busy ? 'Saving…' : 'Apply'}
              </button>
              <button type="button" className="btn btn--ghost btn--small" disabled={busy} onClick={() => setMode('idle')}>
                Cancel
              </button>
            </form>
          )}
          {mode === 'delete' && (
            <div className="row-actions">
              <button
                type="button"
                className="btn btn--danger btn--small"
                disabled={busy}
                onClick={() => void run(() => deleteProduct(p.id), `${p.name} was deleted.`)}
              >
                {busy ? 'Deleting…' : `Confirm: delete ${p.name}`}
              </button>
              <button type="button" className="btn btn--ghost btn--small" disabled={busy} onClick={() => setMode('idle')}>
                Keep
              </button>
            </div>
          )}
        </td>
      )}
    </tr>
  );
}
