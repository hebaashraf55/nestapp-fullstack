import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  adjustProductStock,
  createProduct,
  getBrands,
  getCategories,
  getProduct,
  type Product,
  type ProductInput,
  updateProduct,
} from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { FormField } from '../../components/FormField';
import { useRemote } from '../../hooks/useRemote';
import { centsToInput, formatMoney, parseMoneyToCents } from '../../lib/money';
import { RemoteView } from './RemoteView';

interface Draft {
  name: string;
  description: string;
  images: string;
  price: string;
  discountPercent: string;
  stock: string;
  categoryId: string;
  brandId: string;
}

const EMPTY: Draft = { name: '', description: '', images: '', price: '', discountPercent: '0', stock: '0', categoryId: '', brandId: '' };

const toDraft = (p: Product): Draft => ({
  name: p.name,
  description: p.description,
  images: p.images.join('\n'),
  price: centsToInput(p.priceCents),
  discountPercent: String(p.discountPercent),
  stock: String(p.stock),
  categoryId: p.category?.id ?? '',
  brandId: p.brand?.id ?? '',
});

/** Mirrors the API's rules so mistakes show up before a round trip; the server still decides. */
const IMAGE = /^(https:\/\/[^\s#]+|\/[A-Za-z0-9][A-Za-z0-9_\-./]{0,300}\.(svg|png|jpe?g|webp|avif))$/;

function validate(d: Draft, creating: boolean): { input?: ProductInput; errors: Partial<Record<keyof Draft, string>> } {
  const errors: Partial<Record<keyof Draft, string>> = {};
  const name = d.name.trim();
  if (name.length < 3 || name.length > 100) errors.name = 'Use 3–100 characters.';
  if (d.description.trim().length > 2000) errors.description = 'Keep it under 2,000 characters.';
  const images = d.images.split('\n').map((l) => l.trim()).filter(Boolean);
  if (images.length === 0 || images.length > 6) errors.images = 'Add 1–6 images, one per line.';
  else if (images.some((i) => !IMAGE.test(i) || i.includes('..')))
    errors.images = 'Each image must be an https:// URL or a site path like /catalogue/name.jpg.';
  const priceCents = parseMoneyToCents(d.price);
  if (priceCents === null || priceCents < 1) errors.price = 'Enter a price such as 49 or 49.50.';
  const discountPercent = Number(d.discountPercent);
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 90)
    errors.discountPercent = 'Use a whole number from 0 to 90.';
  const stock = Number(d.stock);
  if (creating && (d.stock.trim() === '' || !Number.isInteger(stock) || stock < 0 || stock > 1_000_000))
    errors.stock = 'Use a whole number from 0 to 1,000,000.';
  if (!d.categoryId) errors.categoryId = 'Choose a category.';
  if (!d.brandId) errors.brandId = 'Choose a brand.';
  if (Object.keys(errors).length > 0) return { errors };
  return {
    errors,
    input: {
      name,
      description: d.description.trim(),
      images,
      priceCents: priceCents as number,
      discountPercent,
      stock,
      categoryId: d.categoryId,
      brandId: d.brandId,
    },
  };
}

/** Only the fields that differ from the saved product, so unchanged values are never rewritten. */
function changedFields(before: Product, input: ProductInput): Partial<ProductInput> {
  const patch: Partial<ProductInput> = {};
  if (input.name !== before.name) patch.name = input.name;
  if (input.description !== before.description) patch.description = input.description;
  if (input.images.join('\n') !== before.images.join('\n')) patch.images = input.images;
  if (input.priceCents !== before.priceCents) patch.priceCents = input.priceCents;
  if (input.discountPercent !== before.discountPercent) patch.discountPercent = input.discountPercent;
  if (input.categoryId !== before.category?.id) patch.categoryId = input.categoryId;
  if (input.brandId !== before.brand?.id) patch.brandId = input.brandId;
  return patch;
}

export function AdminProductForm() {
  const { id } = useParams();
  const { user } = useAuth();
  if (user?.role !== 'ADMIN') {
    return (
      <p className="notice notice--bad" role="alert">
        Only administrators can create or edit products.
      </p>
    );
  }
  return id ? <EditProduct id={id} /> : <ProductForm product={null} />;
}

function EditProduct({ id }: { id: string }) {
  const product = useRemote((s) => getProduct(id, s), `admin-product:${id}`);
  return <RemoteView state={product}>{(p) => <ProductForm product={p} />}</RemoteView>;
}

function ProductForm({ product }: { product: Product | null }) {
  const creating = product === null;
  const navigate = useNavigate();
  const categories = useRemote((s) => getCategories(s), 'form-categories');
  const brands = useRemote((s) => getBrands(s), 'form-brands');
  const [current, setCurrent] = useState<Product | null>(product);
  const [draft, setDraft] = useState<Draft>(product ? toDraft(product) : EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(product ? toDraft(product) : EMPTY);
    setCurrent(product);
  }, [product]);

  const set = (key: keyof Draft) => (e: { target: { value: string } }) => {
    setDraft((d) => ({ ...d, [key]: e.target.value }));
    setSaved(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setSaved(null);
    const { input, errors: found } = validate(draft, creating);
    setErrors(found);
    if (!input) return;
    setBusy(true);
    try {
      if (creating) {
        const created = await createProduct(input);
        navigate('/admin/products', { state: { saved: `${created.name} was created.` } });
        return;
      }
      const patch = changedFields(current as Product, input);
      if (Object.keys(patch).length === 0) {
        setSaved('Nothing changed.');
      } else {
        const updated = await updateProduct((current as Product).id, patch);
        setCurrent(updated);
        setDraft(toDraft(updated));
        setSaved('Changes saved.');
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong');
    }
    setBusy(false);
  };

  const preview = draft.images.split('\n').map((l) => l.trim()).filter((l) => IMAGE.test(l)).slice(0, 6);

  return (
    <section aria-labelledby="product-form-title">
      <p>
        <Link to="/admin/products">← All products</Link>
      </p>
      <h2 id="product-form-title" className="h2--small">
        {creating ? 'New product' : `Edit ${current?.name}`}
      </h2>
      <form className="form form--admin" onSubmit={submit} noValidate>
        <FormField id="product-name" label="Name" error={errors.name}>
          <input value={draft.name} onChange={set('name')} maxLength={100} />
        </FormField>
        <FormField id="product-description" label="Description" error={errors.description}>
          <textarea rows={3} value={draft.description} onChange={set('description')} maxLength={2000} />
        </FormField>
        <div className="form__row">
          <FormField id="product-categoryId" label="Category" error={errors.categoryId}>
            <select value={draft.categoryId} onChange={set('categoryId')}>
              <option value="">Choose…</option>
              {categories.phase === 'ready' && categories.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </FormField>
          <FormField id="product-brandId" label="Brand" error={errors.brandId}>
            <select value={draft.brandId} onChange={set('brandId')}>
              <option value="">Choose…</option>
              {brands.phase === 'ready' && brands.data.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </FormField>
        </div>
        <div className="form__row">
          <FormField id="product-price" label="Price (USD)" error={errors.price}>
            <input inputMode="decimal" value={draft.price} onChange={set('price')} placeholder="49.00" />
          </FormField>
          <FormField id="product-discountPercent" label="Discount %" error={errors.discountPercent}>
            <input type="number" min={0} max={90} step={1} value={draft.discountPercent} onChange={set('discountPercent')} />
          </FormField>
          {creating && (
            <FormField id="product-stock" label="Stock" error={errors.stock}>
              <input type="number" min={0} step={1} value={draft.stock} onChange={set('stock')} />
            </FormField>
          )}
        </div>
        <FormField id="product-images" label="Images (one per line)" error={errors.images}>
          <textarea rows={3} value={draft.images} onChange={set('images')} placeholder="/catalogue/name.jpg or https://…" />
        </FormField>
        {preview.length > 0 && (
          <ul className="image-preview" aria-label="Image preview">
            {preview.map((src) => (
              <li key={src}>
                <img src={src} alt="" width="64" height="80" />
              </li>
            ))}
          </ul>
        )}
        <p className="muted">The sale price is calculated by the server from the price and discount.</p>
        {serverError && (
          <p className="notice notice--bad" role="alert">
            {serverError}
          </p>
        )}
        {saved && (
          <p className="notice" role="status">
            {saved}
          </p>
        )}
        <div className="row-actions">
          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'Saving…' : creating ? 'Create product' : 'Save changes'}
          </button>
          <Link to="/admin/products" className="btn btn--ghost">
            Cancel
          </Link>
        </div>
      </form>
      {!creating && current && <StockPanel product={current} onChanged={setCurrent} />}
    </section>
  );
}

/** Stock is changed relatively (never overwritten) so an order placed meanwhile is not lost. */
function StockPanel({ product, onChanged }: { product: Product; onChanged: (p: Product) => void }) {
  const [change, setChange] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(change);
    if (change.trim() === '' || !Number.isInteger(n) || n === 0) {
      setMessage({ ok: false, text: 'Enter a whole number other than 0, for example 5 to add or -2 to remove.' });
      return;
    }
    if (product.stock + n < 0) {
      setMessage({ ok: false, text: `Only ${product.stock} in stock; you can remove at most ${product.stock}.` });
      return;
    }
    setBusy(true);
    try {
      const updated = await adjustProductStock(product.id, n);
      onChanged(updated);
      setChange('');
      setMessage({ ok: true, text: `Stock is now ${updated.stock}.` });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Something went wrong' });
    }
    setBusy(false);
  };

  return (
    <section className="panel" aria-labelledby="stock-title">
      <h3 id="stock-title" className="h2--small">
        Stock
      </h3>
      <p>
        <strong className="tile__value">{product.stock}</strong> <span className="muted">in stock · sells at {formatMoney(product.salePriceCents, product.currency)}</span>
      </p>
      <form className="row-actions" onSubmit={submit}>
        <label className="field field--compact">
          <span>Add or remove</span>
          <input type="number" step={1} inputMode="numeric" value={change} onChange={(e) => setChange(e.target.value)} placeholder="+5 or -2" />
        </label>
        <button type="submit" className="btn btn--ghost" disabled={busy}>
          {busy ? 'Saving…' : 'Update stock'}
        </button>
      </form>
      {message && (
        <p className={`notice${message.ok ? '' : ' notice--bad'}`} role={message.ok ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}
    </section>
  );
}
