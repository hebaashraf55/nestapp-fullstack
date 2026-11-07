import { useState } from 'react';
import { getAnalytics } from '../../api/client';
import { useRemote } from '../../hooks/useRemote';
import { formatMoney } from '../../lib/money';
import { STATUS_LABEL } from '../../lib/orderText';
import { BarChart } from './BarChart';
import { RemoteView } from './RemoteView';

const RANGES = [7, 30, 90] as const;
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const shortDay = (d: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

/** Sales analytics computed by the server from stored orders only. Payments are simulated. */
export function Analytics() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const report = useRemote((s) => getAnalytics(days, s), `analytics:${days}`);
  return (
    <>
      <div className="admin-toolbar" role="group" aria-label="Period">
        <div className="segmented">
          {RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={days === r} onClick={() => setDays(r)}>
              Last {r} days
            </button>
          ))}
        </div>
      </div>
      <RemoteView state={report}>
        {(a) => {
          const money = (c: number) => formatMoney(c, a.currency);
          return (
            <>
              <p className="notice">
                {a.notice} Every figure comes from orders stored in the database ({shortDay(a.from)} – {shortDay(a.to)}, UTC);
                nothing is estimated.{a.scope === 'demo' && ' The demo viewer sees synthetic orders only.'}
                {a.truncated && <strong> The period holds more orders than the report reads, so these figures are incomplete.</strong>}
              </p>
              <ul className="tiles tiles--stats">
                <li>
                  <span className="tile__label">Paid (simulated)</span>
                  <strong className="tile__value">{money(a.totals.paidCents)}</strong>
                  <span className="muted small">{a.totals.ordersPaid} orders</span>
                </li>
                <li>
                  <span className="tile__label">Refunded (simulated)</span>
                  <strong className="tile__value">{money(a.totals.refundedCents)}</strong>
                  <span className="muted small">net {money(a.totals.netCents)}</span>
                </li>
                <li>
                  <span className="tile__label">Average order</span>
                  <strong className="tile__value">{a.totals.averageOrderCents === null ? '—' : money(a.totals.averageOrderCents)}</strong>
                </li>
                <li>
                  <span className="tile__label">Orders placed → paid</span>
                  <strong className="tile__value">{pct(a.totals.paymentRate)}</strong>
                  <span className="muted small">{a.totals.ordersPlaced} placed</span>
                </li>
                <li>
                  <span className="tile__label">Customers who bought</span>
                  <strong className="tile__value">{a.customers.buyers}</strong>
                  <span className="muted small">
                    {a.customers.returning} returning · {a.customers.guestOrders} guest orders
                  </span>
                </li>
                <li>
                  <span className="tile__label">Returns</span>
                  <strong className="tile__value">{a.returns.requested}</strong>
                  <span className="muted small">rate {pct(a.returns.rate)} of deliveries</span>
                </li>
              </ul>

              <BarChart title="Paid per day (simulated)" bars={a.daily.map((d) => ({ key: d.date, label: shortDay(d.date), value: d.paidCents }))} format={money} />
              <BarChart title="Orders placed per day" bars={a.daily.map((d) => ({ key: d.date, label: shortDay(d.date), value: d.ordersPlaced }))} format={(v) => String(v)} />
              <details className="rules">
                <summary>Daily figures as a table</summary>
                <div className="table-wrap">
                  <table className="table">
                    <caption className="sr-only">Daily figures</caption>
                    <thead>
                      <tr>
                        <th scope="col">Day</th>
                        <th scope="col">Placed</th>
                        <th scope="col">Paid</th>
                        <th scope="col">Paid amount</th>
                        <th scope="col">Refunded</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...a.daily].reverse().map((d) => (
                        <tr key={d.date}>
                          <th scope="row">{shortDay(d.date)}</th>
                          <td className="num">{d.ordersPlaced}</td>
                          <td className="num">{d.ordersPaid}</td>
                          <td className="num">{money(d.paidCents)}</td>
                          <td className="num">{money(d.refundedCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>

              <div className="analytics-grid">
                <section aria-labelledby="top-title">
                  <h2 id="top-title" className="h2--small">
                    Top products
                  </h2>
                  {a.topProducts.length === 0 ? (
                    <p className="notice">Nothing sold in this period.</p>
                  ) : (
                    <table className="table">
                      <caption className="sr-only">Top products by units sold</caption>
                      <thead>
                        <tr>
                          <th scope="col">Product</th>
                          <th scope="col">Units</th>
                          <th scope="col">Revenue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.topProducts.map((p) => (
                          <tr key={p.productId}>
                            <th scope="row">{p.name}</th>
                            <td className="num">{p.units}</td>
                            <td className="num">{money(p.revenueCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
                <section aria-labelledby="status-title">
                  <h2 id="status-title" className="h2--small">
                    Orders placed in the period, by status now
                  </h2>
                  <table className="table">
                    <caption className="sr-only">Orders by status</caption>
                    <tbody>
                      {Object.entries(a.statusOfPlaced).length === 0 && (
                        <tr>
                          <td>No orders placed.</td>
                        </tr>
                      )}
                      {Object.entries(a.statusOfPlaced).map(([s, n]) => (
                        <tr key={s}>
                          <th scope="row">{STATUS_LABEL[s as keyof typeof STATUS_LABEL] ?? s}</th>
                          <td className="num">{n}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
                <section aria-labelledby="coupons-title">
                  <h2 id="coupons-title" className="h2--small">
                    Coupons and offers
                  </h2>
                  {a.coupons.length === 0 ? (
                    <p className="notice">No paid orders used a coupon in this period.</p>
                  ) : (
                    <table className="table">
                      <caption className="sr-only">Coupon use</caption>
                      <thead>
                        <tr>
                          <th scope="col">Code</th>
                          <th scope="col">Orders</th>
                          <th scope="col">Discount given</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.coupons.map((c) => (
                          <tr key={c.code}>
                            <th scope="row" className="code">
                              {c.code}
                            </th>
                            <td className="num">{c.orders}</td>
                            <td className="num">{money(c.discountCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <p className="muted small">Set savings in paid orders: {money(a.totals.bundleSavingsCents)}.</p>
                </section>
              </div>
            </>
          );
        }}
      </RemoteView>
    </>
  );
}
