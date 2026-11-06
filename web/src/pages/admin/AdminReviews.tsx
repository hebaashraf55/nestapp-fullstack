import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getModerationQueue, moderateReview, type ReviewStatus } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Pager } from '../../components/Pager';
import { useRemote } from '../../hooks/useRemote';
import { formatDate } from '../../lib/orderText';
import { Stars } from '../../reviews/Reviews';
import { RemoteView } from './RemoteView';

export function AdminReviews() {
  const { user } = useAuth();
  const readOnly = user?.role !== 'ADMIN';
  const [status, setStatus] = useState<ReviewStatus | ''>('PENDING');
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const queue = useRemote((s) => getModerationQueue(status, page, s), `reviews:${status}:${page}:${version}`);
  const decide = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    setError(null);
    const note = decision === 'REJECTED' ? (window.prompt('Optional note to the author (why it was not published):') ?? undefined) : undefined;
    try {
      await moderateReview(id, decision, note?.trim() || undefined);
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
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as ReviewStatus | '');
              setPage(1);
            }}
          >
            <option value="PENDING">Waiting</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="">All</option>
          </select>
        </label>
      </div>
      {error && (
        <p className="notice notice--bad" role="alert">
          {error}
        </p>
      )}
      <RemoteView state={queue}>
        {(data) =>
          data.items.length === 0 ? (
            <p className="notice">No reviews here.</p>
          ) : (
            <>
              <ul className="moderation">
                {data.items.map((r) => (
                  <li key={r.id} className="card-row">
                    <div>
                      <p className="muted small">
                        {r.product ? <Link to={`/shop/${r.product.id}`}>{r.product.name}</Link> : 'Deleted product'} · {r.authorName} ·{' '}
                        {formatDate(r.createdAt)}
                        {r.verifiedPurchase && ' · Verified purchase'}
                      </p>
                      <Stars value={r.rating} />
                      <h3>{r.title}</h3>
                      <p>{r.body}</p>
                      {r.moderationNote && <p className="muted small">Note: {r.moderationNote}</p>}
                    </div>
                    <div className="moderation__actions">
                      <span className="pill" data-status={r.status}>
                        {r.status.toLowerCase()}
                      </span>
                      {!readOnly && r.status !== 'APPROVED' && (
                        <button type="button" className="btn btn--small" onClick={() => void decide(r.id, 'APPROVED')}>
                          Approve
                        </button>
                      )}
                      {!readOnly && r.status !== 'REJECTED' && (
                        <button type="button" className="btn btn--ghost btn--small" onClick={() => void decide(r.id, 'REJECTED')}>
                          Reject
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <Pager page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />
            </>
          )
        }
      </RemoteView>
    </>
  );
}
