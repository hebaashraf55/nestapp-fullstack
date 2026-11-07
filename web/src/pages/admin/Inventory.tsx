import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getMovements, type MovementReason } from '../../api/client';
import { Pager } from '../../components/Pager';
import { useRemote } from '../../hooks/useRemote';
import { formatDate } from '../../lib/orderText';
import { RemoteView } from './RemoteView';

export const REASON_LABEL: Record<MovementReason, string> = {
  INITIAL: 'Opening stock',
  RECEIVED: 'Goods received',
  CORRECTION: 'Count correction',
  DAMAGED: 'Damaged',
  LOST: 'Lost',
  ORDER_RESERVED: 'Reserved by an order',
  ORDER_RELEASED: 'Released (cancelled, expired or refunded)',
  RETURN_RESTOCK: 'Returned to stock',
};

/** Every stock change with its reason, newest first. Read-only: the history cannot be edited. */
export function Inventory() {
  const [params] = useSearchParams();
  const productId = params.get('product') ?? undefined;
  const [reason, setReason] = useState<MovementReason | ''>('');
  const [page, setPage] = useState(1);
  const list = useRemote((s) => getMovements({ productId, reason, page }, s), `moves:${productId ?? ''}:${reason}:${page}`);
  return (
    <>
      <div className="admin-toolbar">
        <label className="field">
          <span>Reason</span>
          <select
            value={reason}
            onChange={(e) => {
              setReason(e.target.value as MovementReason | '');
              setPage(1);
            }}
          >
            <option value="">All reasons</option>
            {Object.entries(REASON_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        {productId && <Link to="/admin/inventory">Show all products</Link>}
      </div>
      <RemoteView state={list}>
        {(data) =>
          data.items.length === 0 ? (
            <p className="notice">No stock changes recorded yet.</p>
          ) : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <caption className="sr-only">Stock history</caption>
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Product</th>
                      <th scope="col">Change</th>
                      <th scope="col">Reason</th>
                      <th scope="col">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((m) => (
                      <tr key={m.id}>
                        <td className="nowrap">{formatDate(m.createdAt)}</td>
                        <th scope="row">
                          <Link to={`/admin/inventory?product=${m.productId}`}>{m.productName}</Link>
                        </th>
                        <td className="num" data-sign={m.change > 0 ? 'up' : 'down'}>
                          {m.change > 0 ? `+${m.change}` : m.change}
                        </td>
                        <td>{REASON_LABEL[m.reason]}</td>
                        <td className="small">
                          {m.note ?? (m.orderId ? `Order …${m.orderId.slice(-6)}` : m.actorId ? 'By an admin' : '—')}
                        </td>
                      </tr>
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
