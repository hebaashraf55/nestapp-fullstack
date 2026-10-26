import { useState } from 'react';
import { getAdminCustomers } from '../../api/client';
import { Pager } from '../../components/Pager';
import { useRemote } from '../../hooks/useRemote';
import { formatDate } from '../../lib/orderText';
import { RemoteView } from './RemoteView';

export function Customers() {
  const [page, setPage] = useState(1);
  const customers = useRemote((s) => getAdminCustomers(page, s), `customers:${page}`);
  return (
    <RemoteView state={customers}>
      {(data) => (
        <>
          <p className="muted">Names and emails are masked by the server. Full details are never sent to this page.</p>
          {data.items.length === 0 ? (
            <p className="notice">No customers yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Customers</caption>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Email</th>
                    <th scope="col">Verified</th>
                    <th scope="col">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((c) => (
                    <tr key={c.id}>
                      <th scope="row">
                        {c.displayName} {c.isDemo && <span className="pill">demo</span>}
                      </th>
                      <td>{c.maskedEmail}</td>
                      <td>{c.emailVerified ? 'Yes' : 'No'}</td>
                      <td>{formatDate(c.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pager page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />
        </>
      )}
    </RemoteView>
  );
}
