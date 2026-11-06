import { type FormEvent, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  deleteReview,
  editReview,
  getProductReviews,
  type OwnReview,
  type RatingSummary,
  type ReviewSort,
  writeReview,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useRemote } from '../hooks/useRemote';
import { formatDate } from '../lib/orderText';

export function Stars({ value, label }: { value: number; label?: string }) {
  const rounded = Math.round(value * 2) / 2;
  return (
    <span className="stars" role="img" aria-label={label ?? `${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} aria-hidden="true" data-fill={rounded >= n ? 'full' : rounded >= n - 0.5 ? 'half' : 'none'}>
          ★
        </span>
      ))}
    </span>
  );
}

function Summary({ summary }: { summary: RatingSummary }) {
  if (summary.count === 0) return <p className="muted">No reviews yet.</p>;
  return (
    <div className="rating-summary">
      <p className="rating-summary__avg">
        <strong>{summary.average?.toFixed(1)}</strong>
        <Stars value={summary.average ?? 0} />
        <span className="muted">
          {summary.count} {summary.count === 1 ? 'review' : 'reviews'}
        </span>
      </p>
      <ul className="rating-bars" aria-label="Ratings by stars">
        {[5, 4, 3, 2, 1].map((star) => {
          const n = summary.distribution[star - 1] ?? 0;
          return (
            <li key={star}>
              <span>{star} ★</span>
              <span className="rating-bars__track" aria-hidden="true">
                <span style={{ width: `${(n / summary.count) * 100}%` }} />
              </span>
              <span aria-label={`${n} with ${star} stars`}>{n}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const STATUS_TEXT: Record<OwnReview['status'], string> = {
  PENDING: 'Waiting for moderation. It appears here once approved.',
  APPROVED: 'Published.',
  REJECTED: 'Not published.',
};

function ReviewForm({ productId, existing, onDone }: { productId: string; existing: OwnReview | null; onDone: () => void }) {
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (rating < 1) return setState({ busy: false, error: 'Choose a rating from 1 to 5 stars.' });
    if (title.trim().length < 2) return setState({ busy: false, error: 'Add a short title.' });
    if (body.trim().length < 10) return setState({ busy: false, error: 'Write at least 10 characters.' });
    setState({ busy: true });
    try {
      const input = { rating, title: title.trim(), body: body.trim() };
      await (existing ? editReview(existing.id, input) : writeReview(productId, input));
      onDone();
    } catch (err) {
      setState({ busy: false, error: err instanceof Error ? err.message : 'Something went wrong' });
    }
  };
  return (
    <form className="review-form" onSubmit={submit} noValidate>
      <fieldset className="star-input">
        <legend>Your rating</legend>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n}>
            <input
              type="radio"
              name="rating"
              value={n}
              checked={rating === n}
              onChange={() => setRating(n)}
              aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`}
            />
            <span aria-hidden="true" data-on={rating >= n}>
              ★
            </span>
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span>Title</span>
        <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>Review</span>
        <textarea value={body} maxLength={2000} rows={4} onChange={(e) => setBody(e.target.value)} />
      </label>
      {state.error && (
        <p className="error-text" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" className="btn" disabled={state.busy}>
        {state.busy ? 'Sending…' : existing ? 'Update review' : 'Submit review'}
      </button>
      <p className="muted small">Reviews are checked before they appear. “Verified purchase” is added automatically when you have bought this piece.</p>
    </form>
  );
}

function Mine({ productId, mine, reload }: { productId: string; mine: OwnReview | null; reload: () => void }) {
  const { user } = useAuth();
  const location = useLocation();
  const [editing, setEditing] = useState(false);
  if (!user)
    return (
      <p className="notice">
        <Link to="/login" state={{ from: location.pathname }}>
          Sign in
        </Link>{' '}
        to write a review.
      </p>
    );
  if (user.role !== 'CUSTOMER') return null;
  if (!mine || editing)
    return (
      <ReviewForm
        productId={productId}
        existing={mine}
        onDone={() => {
          setEditing(false);
          reload();
        }}
      />
    );
  return (
    <div className="notice review-mine">
      <p>
        <strong>Your review</strong> · <Stars value={mine.rating} /> · {STATUS_TEXT[mine.status]}
        {mine.moderationNote && <> Note from the shop: “{mine.moderationNote}”</>}
      </p>
      <p className="review-mine__actions">
        <button type="button" className="link" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            if (window.confirm('Delete your review?')) void deleteReview(mine.id).then(reload);
          }}
        >
          Delete
        </button>
      </p>
    </div>
  );
}

export function Reviews({ productId }: { productId: string }) {
  const { user } = useAuth();
  const [sort, setSort] = useState<ReviewSort>('newest');
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const data = useRemote((s) => getProductReviews(productId, sort, page, s), `${productId}:${sort}:${page}:${version}:${user?.id ?? ''}`);
  const reload = () => setVersion((v) => v + 1);
  return (
    <section className="reviews" aria-labelledby="reviews-title">
      <div className="section-head">
        <h2 id="reviews-title">Reviews</h2>
        <label className="field field--inline">
          <span>Sort</span>
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as ReviewSort);
              setPage(1);
            }}
          >
            <option value="newest">Newest</option>
            <option value="highest">Highest rated</option>
            <option value="lowest">Lowest rated</option>
          </select>
        </label>
      </div>
      {data.phase === 'loading' && <p className="muted">Loading reviews…</p>}
      {data.phase === 'error' && (
        <p className="notice notice--bad" role="alert">
          Reviews are unavailable right now ({data.error.message}).
        </p>
      )}
      {data.phase === 'ready' && (
        <div className="reviews__grid">
          <div>
            <Summary summary={data.data.summary} />
            <Mine productId={productId} mine={data.data.mine} reload={reload} />
          </div>
          <div>
            <ol className="review-list">
              {data.data.items.map((r) => (
                <li key={r.id}>
                  <Stars value={r.rating} />
                  <h3>{r.title}</h3>
                  <p>{r.body}</p>
                  <p className="muted small">
                    {r.authorName} · {formatDate(r.createdAt)}
                    {r.verifiedPurchase && <span className="verified"> · Verified purchase</span>}
                  </p>
                </li>
              ))}
            </ol>
            {data.data.totalPages > 1 && (
              <p className="review-pager">
                <button type="button" className="link" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Newer
                </button>
                <span>
                  Page {page} of {data.data.totalPages}
                </span>
                <button type="button" className="link" disabled={page >= data.data.totalPages} onClick={() => setPage(page + 1)}>
                  Older
                </button>
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
