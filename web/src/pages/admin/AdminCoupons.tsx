import { type FormEvent, useState } from 'react';
import { type Coupon, type CouponInput, createCoupon, deleteCoupon, getCategories, getCoupons, type Product, updateCoupon } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { FormField } from '../../components/FormField';
import { useRemote } from '../../hooks/useRemote';
import { formatMoney, parseMoneyToCents } from '../../lib/money';
import { formatDate } from '../../lib/orderText';
import { ProductPicker } from './ProductPicker';
import { RemoteView } from './RemoteView';

const STATUS_LABEL: Record<Coupon['status'], string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Paused',
  EXPIRED: 'Expired',
  SCHEDULED: 'Scheduled',
  USED_UP: 'Used up',
};
const CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/;

/** A date input (yyyy-mm-dd) → the end (or start) of that day in the admin's time zone, as ISO. */
const endOfDay = (day: string): string => new Date(`${day}T23:59:59`).toISOString();
const startOfDay = (day: string): string => new Date(`${day}T00:00:00`).toISOString();
const toDay = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const todayPlus = (days: number) => toDay(new Date(Date.now() + days * 86_400_000).toISOString());

function checkPercent(text: string): string | null {
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= 90 ? null : 'Use a whole number from 1 to 90.';
}
function checkDay(day: string): string | null {
  if (!day) return 'Choose an expiry date.';
  const end = new Date(`${day}T23:59:59`).getTime();
  if (Number.isNaN(end) || end <= Date.now()) return 'The expiry date must be in the future.';
  if (end > Date.now() + 5 * 365 * 86_400_000) return 'The expiry date must be within five years.';
  return null;
}
const optionalCount = (text: string): number | null | 'bad' => {
  if (!text.trim()) return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= 1_000_000 ? n : 'bad';
};

/** "15% off", "$10.00 off", plus the rules that limit it. */
export function describeCoupon(c: Coupon): { discount: string; rules: string } {
  const discount = c.discountType === 'FIXED' ? `${formatMoney(c.amountOffCents ?? 0)} off` : `${c.discountPercent}% off`;
  const rules = [
    c.automatic ? 'automatic' : null,
    c.minSubtotalCents ? `min. ${formatMoney(c.minSubtotalCents)}` : null,
    c.scope === 'PRODUCTS' ? `${c.productIds?.length ?? 0} products` : c.scope === 'CATEGORIES' ? `${c.categoryIds?.length ?? 0} categories` : null,
    c.startsAt ? `from ${formatDate(c.startsAt)}` : null,
    c.maxUses ? `${c.usedCount ?? 0}/${c.maxUses} uses` : null,
    c.maxUsesPerCustomer ? `${c.maxUsesPerCustomer} per customer` : null,
  ].filter(Boolean);
  return { discount, rules: rules.join(' · ') || '—' };
}

export function AdminCoupons() {
  const { user } = useAuth();
  const canChange = user?.role === 'ADMIN';
  const [reload, setReload] = useState(0);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const coupons = useRemote((s) => getCoupons(s), `coupons:${reload}`);

  const changed = (text: string, ok = true, reloadList = true) => {
    setMessage({ ok, text });
    if (reloadList) setReload((n) => n + 1);
  };

  return (
    <>
      {canChange && <NewCoupon onCreated={changed} />}
      {message && (
        <p className={`notice${message.ok ? '' : ' notice--bad'}`} role={message.ok ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}
      <h2 className="h2--small">Coupons and promotions</h2>
      <p className="muted">
        Percentage or fixed-amount discounts, priced by the server. A use is held by each placed order and given back if
        the order is cancelled or expires. Placed orders keep their own copy of a code, so editing or deleting a coupon
        never changes them.
      </p>
      <RemoteView state={coupons}>
        {(list) =>
          list.length === 0 ? (
            <p className="notice">No coupons yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table table--admin">
                <caption className="sr-only">Coupons</caption>
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Discount</th>
                    <th scope="col">Rules</th>
                    <th scope="col">Expires</th>
                    <th scope="col">Status</th>
                    <th scope="col">Orders</th>
                    {canChange && (
                      <th scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => (
                    <CouponRow key={c.id} coupon={c} canChange={canChange} onChanged={changed} />
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </RemoteView>
    </>
  );
}

function NewCoupon({ onCreated }: { onCreated: (text: string, ok?: boolean) => void }) {
  const categories = useRemote((s) => getCategories(s), 'coupon-categories');
  const [code, setCode] = useState('');
  const [type, setType] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [percent, setPercent] = useState('10');
  const [amount, setAmount] = useState('10');
  const [day, setDay] = useState(todayPlus(30));
  const [startDay, setStartDay] = useState('');
  const [minSpend, setMinSpend] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [perCustomer, setPerCustomer] = useState('');
  const [scope, setScope] = useState<'ALL' | 'PRODUCTS' | 'CATEGORIES'>('ALL');
  const [products, setProducts] = useState<Pick<Product, 'id' | 'name'>[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [automatic, setAutomatic] = useState(false);
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!CODE.test(code.trim())) found.code = 'Use 3–32 letters, digits, "-" or "_".';
    if (type === 'PERCENT' && checkPercent(percent)) found.percent = checkPercent(percent) as string;
    const amountCents = parseMoneyToCents(amount);
    if (type === 'FIXED' && (amountCents === null || amountCents < 1)) found.amount = 'Enter an amount such as 10 or 7.50.';
    if (checkDay(day)) found.day = checkDay(day) as string;
    if (startDay && new Date(`${startDay}T00:00:00`).getTime() >= new Date(`${day}T23:59:59`).getTime())
      found.startDay = 'Must be before the expiry date.';
    const minCents = minSpend.trim() ? parseMoneyToCents(minSpend) : 0;
    if (minCents === null) found.minSpend = 'Enter an amount such as 50.';
    const uses = optionalCount(maxUses);
    const per = optionalCount(perCustomer);
    if (uses === 'bad') found.maxUses = 'Use a whole number, or leave empty for no limit.';
    if (per === 'bad') found.perCustomer = 'Use a whole number, or leave empty for no limit.';
    if (typeof uses === 'number' && typeof per === 'number' && per > uses) found.perCustomer = 'Cannot exceed the total limit.';
    if (scope === 'PRODUCTS' && products.length === 0) found.scope = 'Choose at least one product.';
    if (scope === 'CATEGORIES' && categoryIds.length === 0) found.scope = 'Choose at least one category.';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    const input: CouponInput = {
      code: code.trim(),
      ...(type === 'PERCENT' ? { discountPercent: Number(percent) } : { type, amountOffCents: amountCents as number }),
      expiresAt: endOfDay(day),
      active,
      ...(startDay ? { startsAt: startOfDay(startDay) } : {}),
      ...(minCents ? { minSubtotalCents: minCents } : {}),
      ...(typeof uses === 'number' ? { maxUses: uses } : {}),
      ...(typeof per === 'number' ? { maxUsesPerCustomer: per } : {}),
      ...(scope === 'PRODUCTS' ? { scope, productIds: products.map((p) => p.id) } : {}),
      ...(scope === 'CATEGORIES' ? { scope, categoryIds } : {}),
      ...(automatic ? { automatic } : {}),
    };
    try {
      const created = await createCoupon(input);
      setCode('');
      onCreated(`Coupon ${created.code} was created${created.active ? '' : ' (paused)'}.`);
    } catch (err) {
      onCreated(err instanceof Error ? err.message : 'Something went wrong', false);
    }
    setBusy(false);
  };

  return (
    <form className="panel form--admin" onSubmit={submit} noValidate aria-labelledby="new-coupon-title">
      <h2 id="new-coupon-title" className="h2--small">
        New coupon
      </h2>
      <div className="form__row">
        <FormField id="coupon-code" label="Code" error={errors.code}>
          <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={32} placeholder="SPRING15" autoCapitalize="characters" />
        </FormField>
        <FormField id="coupon-type" label="Type">
          <select value={type} onChange={(e) => setType(e.target.value as 'PERCENT' | 'FIXED')}>
            <option value="PERCENT">Percentage</option>
            <option value="FIXED">Fixed amount</option>
          </select>
        </FormField>
        {type === 'PERCENT' ? (
          <FormField id="coupon-percent" label="Discount %" error={errors.percent}>
            <input type="number" min={1} max={90} step={1} value={percent} onChange={(e) => setPercent(e.target.value)} />
          </FormField>
        ) : (
          <FormField id="coupon-amount" label="Amount off (USD)" error={errors.amount}>
            <input type="number" min={0.01} step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </FormField>
        )}
        <FormField id="coupon-day" label="Expires on" error={errors.day}>
          <input type="date" value={day} min={todayPlus(0)} onChange={(e) => setDay(e.target.value)} />
        </FormField>
      </div>
      <details className="rules">
        <summary>Rules (optional): start date, minimum spend, limits, scope, automatic</summary>
        <div className="form__row">
          <FormField id="coupon-start" label="Starts on" error={errors.startDay}>
            <input type="date" value={startDay} min={todayPlus(0)} onChange={(e) => setStartDay(e.target.value)} />
          </FormField>
          <FormField id="coupon-min" label="Minimum spend (USD)" error={errors.minSpend}>
            <input type="number" min={0} step={0.01} value={minSpend} onChange={(e) => setMinSpend(e.target.value)} placeholder="none" />
          </FormField>
          <FormField id="coupon-max" label="Total uses" error={errors.maxUses}>
            <input type="number" min={1} step={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="unlimited" />
          </FormField>
          <FormField id="coupon-per" label="Uses per customer" error={errors.perCustomer}>
            <input type="number" min={1} step={1} value={perCustomer} onChange={(e) => setPerCustomer(e.target.value)} placeholder="unlimited" />
          </FormField>
        </div>
        <FormField id="coupon-scope" label="Applies to" error={errors.scope}>
          <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
            <option value="ALL">The whole cart</option>
            <option value="CATEGORIES">Some categories</option>
            <option value="PRODUCTS">Some products</option>
          </select>
        </FormField>
        {scope === 'CATEGORIES' && categories.phase === 'ready' && (
          <fieldset className="checks">
            <legend className="sr-only">Categories</legend>
            {categories.data.map((c) => (
              <label key={c.id} className="check">
                <input
                  type="checkbox"
                  checked={categoryIds.includes(c.id)}
                  onChange={(e) => setCategoryIds(e.target.checked ? [...categoryIds, c.id] : categoryIds.filter((x) => x !== c.id))}
                />
                {c.name}
              </label>
            ))}
          </fieldset>
        )}
        {scope === 'PRODUCTS' && (
          <>
            <ul className="picked" aria-label="Products this coupon applies to">
              {products.map((p) => (
                <li key={p.id}>
                  <span>{p.name}</span>
                  <button type="button" className="link" onClick={() => setProducts(products.filter((x) => x.id !== p.id))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <ProductPicker exclude={products.map((p) => p.id)} onPick={(p) => setProducts([...products, p])} />
          </>
        )}
        <label className="check">
          <input type="checkbox" checked={automatic} onChange={(e) => setAutomatic(e.target.checked)} /> Automatic: applies without a code
          whenever the cart qualifies (the best single offer is used)
        </label>
      </details>
      <label className="check">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (customers can use it right away)
      </label>
      <div>
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Creating…' : 'Create coupon'}
        </button>
      </div>
    </form>
  );
}

function CouponRow({ coupon: c, canChange, onChanged }: { coupon: Coupon; canChange: boolean; onChanged: (text: string, ok?: boolean, reloadList?: boolean) => void }) {
  const [mode, setMode] = useState<'idle' | 'edit' | 'delete'>('idle');
  const fixed = c.discountType === 'FIXED';
  const [value, setValue] = useState(fixed ? String((c.amountOffCents ?? 0) / 100) : String(c.discountPercent));
  const [day, setDay] = useState(toDay(c.expiresAt));
  const [busy, setBusy] = useState(false);
  const { discount, rules } = describeCoupon(c);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      onChanged(success);
    } catch (err) {
      onChanged(err instanceof Error ? err.message : 'Something went wrong', false);
    }
    setBusy(false);
    setMode('idle');
  };

  const saveEdit = (e: FormEvent) => {
    e.preventDefault();
    const cents = fixed ? parseMoneyToCents(value) : null;
    const problem = (fixed ? (cents === null || cents < 1 ? 'Enter an amount such as 10.' : null) : checkPercent(value)) ?? checkDay(day);
    if (problem) {
      onChanged(`${c.code}: ${problem}`, false, false);
      return;
    }
    const patch = {
      ...(!fixed && Number(value) !== c.discountPercent ? { discountPercent: Number(value) } : {}),
      ...(fixed && cents !== c.amountOffCents ? { amountOffCents: cents as number } : {}),
      ...(day !== toDay(c.expiresAt) ? { expiresAt: endOfDay(day) } : {}),
    };
    if (Object.keys(patch).length === 0) {
      setMode('idle');
      return;
    }
    void run(() => updateCoupon(c.id, patch), `${c.code} was updated.`);
  };

  return (
    <tr>
      <th scope="row" className="code">
        {c.code}
      </th>
      <td className="nowrap">{discount}</td>
      <td className="small">{rules}</td>
      <td className="nowrap">{formatDate(c.expiresAt)}</td>
      <td>
        <span className="pill" data-status={c.status === 'INACTIVE' ? 'PAUSED' : c.status}>
          {STATUS_LABEL[c.status]}
        </span>
      </td>
      <td className="num">{c.ordersPlaced}</td>
      {canChange && (
        <td>
          {mode === 'idle' && (
            <div className="row-actions">
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => {
                  setValue(fixed ? String((c.amountOffCents ?? 0) / 100) : String(c.discountPercent)); // start from saved values
                  setDay(toDay(c.expiresAt));
                  setMode('edit');
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                disabled={busy}
                onClick={() => void run(() => updateCoupon(c.id, { active: !c.active }), `${c.code} is now ${c.active ? 'paused' : 'active'}.`)}
              >
                {c.active ? 'Pause' : 'Activate'}
              </button>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => setMode('delete')}>
                Delete
              </button>
            </div>
          )}
          {mode === 'edit' && (
            <form className="row-actions" onSubmit={saveEdit}>
              <label className="field field--compact">
                <span>{fixed ? 'Amount off (USD)' : 'Discount %'}</span>
                <input type="number" min={fixed ? 0.01 : 1} max={fixed ? undefined : 90} step={fixed ? 0.01 : 1} value={value} onChange={(e) => setValue(e.target.value)} />
              </label>
              <label className="field field--compact">
                <span>Expires on</span>
                <input type="date" value={day} min={todayPlus(0)} onChange={(e) => setDay(e.target.value)} />
              </label>
              <button type="submit" className="btn btn--small" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="btn btn--ghost btn--small" disabled={busy} onClick={() => setMode('idle')}>
                Cancel
              </button>
            </form>
          )}
          {mode === 'delete' && (
            <div className="row-actions">
              <button type="button" className="btn btn--danger btn--small" disabled={busy} onClick={() => void run(() => deleteCoupon(c.id), `${c.code} was deleted.`)}>
                {busy ? 'Deleting…' : `Confirm: delete ${c.code}`}
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
