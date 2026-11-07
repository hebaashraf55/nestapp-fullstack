import { useState } from 'react';
import { decideReturn, getReturns, type ReturnRequest } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useRemote } from '../../hooks/useRemote';
import { formatMoney } from '../../lib/money';
import { formatDate, RETURN_LABEL } from '../../lib/orderText';
import { RemoteView } from './RemoteView';

export function AdminReturns() {
  const { user } = useAuth();
  const admin = user?.role === 'ADMIN';
  const [status, setStatus] = useState<ReturnRequest['status'] | ''>('REQUESTED');
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const list = useRemote((s) => getReturns(status, s), `returns:${status}:${version}`);
  const decide = async (id: string, decision: 'APPROVED' | 'REJECTED' | 'RECEIVED') => {
    const note =
      decision === 'RECEIVED'
        ? undefined
        : window.prompt(decision === 'REJECTED' ? 'Why is the return declined? (shown to the customer)' : 'Note for the customer (optional):')?.trim() || undefined;
    if (decision === 'REJECTED' && !note) return;
    setError(null);
    try {
      await decideReturn(id, decision, note);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
  };
  return (
    <>
      <div className="admin-toolbar">
        <label className="field">
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as ReturnRequest['status'] | '')}>
            <option value="REQUESTED">Waiting</option>
            <option value="APPROVED">Approved (awaiting the items)</option>
            <option value="RECEIVED">Received and refunded</option>
            <option value="REJECTED">Declined</option>
            <option value="">All</option>
          </select>
        </label>
      </div>
      {error && (
        <p className="notice notice--bad" role="alert">
          {error}
        </p>
      )}
      <RemoteView state={list}>
        {(orders) =>
          orders.length === 0 ? (
            <p className="notice">No returns here.</p>
          ) : (
            <ul className="moderation">
              {orders.map((o) => (
                <li key={o.id} className="card-row">
                  <div>
                    <p className="muted small">
                      Order …{o.id.slice(-6)} · {formatMoney(o.totalCents, o.currency)} · requested {formatDate(o.returnRequest!.requestedAt)}
                    </p>
                    <h3>{RETURN_LABEL[o.returnRequest!.status]}</h3>
                    <p>“{o.returnRequest!.reason}”</p>
                    <p className="muted small">{o.items.map((i) => `${i.name} × ${i.quantity}`).join(' · ')}</p>
                  </div>
                  {admin && (
                    <div className="moderation__actions">
                      {o.returnRequest!.status === 'REQUESTED' && (
                        <>
                          <button type="button" className="btn btn--small" onClick={() => void decide(o.id, 'APPROVED')}>
                            Approve
                          </button>
                          <button type="button" className="btn btn--ghost btn--small" onClick={() => void decide(o.id, 'REJECTED')}>
                            Decline
                          </button>
                        </>
                      )}
                      {o.returnRequest!.status === 'APPROVED' && (
                        <button type="button" className="btn btn--small" onClick={() => void decide(o.id, 'RECEIVED')}>
                          Mark received (simulated refund)
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )
        }
      </RemoteView>
    </>
  );
}
