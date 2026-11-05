import { type FormEvent, useState } from 'react';
import { type Coupon, createCoupon, deleteCoupon, getCoupons, updateCoupon } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { FormField } from '../../components/FormField';
import { useRemote } from '../../hooks/useRemote';
import { formatDate } from '../../lib/orderText';
import { RemoteView } from './RemoteView';

const STATUS_LABEL: Record<Coupon['status'], string> = { ACTIVE: 'Active', INACTIVE: 'Paused', EXPIRED: 'Expired' };
const CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/;

/** A date input (yyyy-mm-dd) → the end of that day in the admin's time zone, as ISO. */
const endOfDay = (day: string): string => new Date(`${day}T23:59:59`).toISOString();
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
      <h2 className="h2--small">Coupons</h2>
      <p className="muted">Percentage discounts only. Placed orders keep their own copy of a code, so editing or deleting a coupon never changes them.</p>
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
                    <th scope="col">Expires</th>
                    <th scope="col">Status</th>
                    <th scope="col">Orders</th>
                    {canChange && <th scope="col"><span className="sr-only">Actions</span></th>}
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
  const [code, setCode] = useState('');
  const [percent, setPercent] = useState('10');
  const [day, setDay] = useState(todayPlus(30));
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState<{ code?: string; percent?: string; day?: string }>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = {
      ...(CODE.test(code.trim()) ? {} : { code: 'Use 3–32 letters, digits, "-" or "_".' }),
      ...(checkPercent(percent) ? { percent: checkPercent(percent) as string } : {}),
      ...(checkDay(day) ? { day: checkDay(day) as string } : {}),
    };
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      const created = await createCoupon({ code: code.trim(), discountPercent: Number(percent), expiresAt: endOfDay(day), active });
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
        <FormField id="coupon-percent" label="Discount %" error={errors.percent}>
          <input type="number" min={1} max={90} step={1} value={percent} onChange={(e) => setPercent(e.target.value)} />
        </FormField>
        <FormField id="coupon-day" label="Expires on" error={errors.day}>
          <input type="date" value={day} min={todayPlus(0)} onChange={(e) => setDay(e.target.value)} />
        </FormField>
      </div>
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
  const [percent, setPercent] = useState(String(c.discountPercent));
  const [day, setDay] = useState(toDay(c.expiresAt));
  const [busy, setBusy] = useState(false);

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
    const problem = checkPercent(percent) ?? checkDay(day);
    if (problem) {
      onChanged(`${c.code}: ${problem}`, false, false);
      return;
    }
    const patch = {
      ...(Number(percent) !== c.discountPercent ? { discountPercent: Number(percent) } : {}),
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
      <td className="nowrap">{c.discountPercent}% off</td>
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
                  setPercent(String(c.discountPercent)); // start from the saved values, not a stale draft
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
                <span>Discount %</span>
                <input type="number" min={1} max={90} step={1} value={percent} onChange={(e) => setPercent(e.target.value)} />
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
