import { useState } from 'react';
import { getAuditLog } from '../../api/client';
import { Pager } from '../../components/Pager';
import { useRemote } from '../../hooks/useRemote';
import { formatDate } from '../../lib/orderText';
import { RemoteView } from './RemoteView';

export function AuditLog() {
  const [page, setPage] = useState(1);
  const log = useRemote((s) => getAuditLog(page, s), `audit:${page}`);
  return (
    <RemoteView state={log}>
      {(data) => (
        <>
          <p className="muted">Every successful admin change is recorded here. Entries cannot be edited or deleted.</p>
          {data.items.length === 0 ? (
            <p className="notice">Nothing has been recorded yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Audit log</caption>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Action</th>
                    <th scope="col">Target</th>
                    <th scope="col">Detail</th>
                    <th scope="col">By</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((e) => (
                    <tr key={e.id}>
                      <td>{formatDate(e.createdAt)}</td>
                      <th scope="row">{e.action}</th>
                      <td>{e.targetId ? `…${e.targetId.slice(-6)}` : '—'}</td>
                      <td>{e.detail ?? '—'}</td>
                      <td>
                        {e.actorRole.toLowerCase()} …{e.actorId.slice(-6)}
                      </td>
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
