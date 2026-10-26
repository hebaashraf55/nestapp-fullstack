import { getAdminStats } from '../../api/client';
import { useRemote } from '../../hooks/useRemote';
import { formatMoney } from '../../lib/money';
import { STATUS_LABEL } from '../../lib/orderText';
import { RemoteView } from './RemoteView';

export function Dashboard() {
  const stats = useRemote((s) => getAdminStats(s), 'stats');
  return (
    <RemoteView state={stats}>
      {(s) => (
        <>
          <p className="muted">
            {s.scope === 'demo' ? 'Showing synthetic demo records only.' : 'Showing all records.'} {s.notice}
          </p>
          <ul className="tiles">
            <li>
              <span className="tile__value">{s.customers}</span>
              <span className="tile__label">Customers</span>
            </li>
            <li>
              <span className="tile__value">{s.orders.total}</span>
              <span className="tile__label">Orders</span>
            </li>
            <li>
              <span className="tile__value">{formatMoney(s.simulatedPaidCents, s.currency)}</span>
              <span className="tile__label">Simulated paid</span>
            </li>
            <li>
              <span className="tile__value">{formatMoney(s.simulatedRefundedCents, s.currency)}</span>
              <span className="tile__label">Simulated refunded</span>
            </li>
            <li>
              <span className="tile__value">{s.products.total}</span>
              <span className="tile__label">Products</span>
            </li>
            <li>
              <span className="tile__value">{s.products.lowStock}</span>
              <span className="tile__label">Low stock (≤ {s.products.lowStockThreshold})</span>
            </li>
            <li>
              <span className="tile__value">{s.products.outOfStock}</span>
              <span className="tile__label">Sold out</span>
            </li>
          </ul>
          <h2 className="h2--small">Orders by status</h2>
          <table className="table">
            <caption className="sr-only">Orders by status</caption>
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">Orders</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(s.orders.byStatus) as (keyof typeof s.orders.byStatus)[]).map((status) => (
                <tr key={status}>
                  <th scope="row">{STATUS_LABEL[status]}</th>
                  <td>{s.orders.byStatus[status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </RemoteView>
  );
}
