import { Link, useParams } from 'react-router-dom';
import { ApiError, getLook, getLooks } from '../api/client';
import { AddSet } from '../collections/AddSet';
import { LookCard } from '../collections/LookCard';
import { ProductCard } from '../components/ProductCard';
import { useRemote } from '../hooks/useRemote';
import { formatMoney } from '../lib/money';

export function Looks() {
  const looks = useRemote((s) => getLooks({}, s), 'looks');
  return (
    <div className="page">
      <header className="page__head">
        <p className="eyebrow">Shop the Look</p>
        <h1 className="h1--small">Rooms, put together</h1>
        <p className="lede lede--small">Each look gathers pieces that work together. Add one, or the whole room in one step.</p>
      </header>
      {looks.phase === 'loading' && <p className="muted">Loading looks…</p>}
      {looks.phase === 'error' && (
        <p className="notice notice--bad" role="alert">
          Looks are unavailable right now ({looks.error.message}).
        </p>
      )}
      {looks.phase === 'ready' &&
        (looks.data.length === 0 ? (
          <p className="notice">No looks yet.</p>
        ) : (
          <div className="looks">
            {looks.data.map((l) => (
              <LookCard key={l.id} look={l} />
            ))}
          </div>
        ))}
    </div>
  );
}

export function LookDetail() {
  const { slug = '' } = useParams();
  const look = useRemote((s) => getLook(slug, s), slug);
  if (look.phase === 'loading') return <div className="page muted">Loading…</div>;
  if (look.phase === 'error') {
    const missing = look.error instanceof ApiError && look.error.statusCode === 404;
    return (
      <div className="page">
        <p className="notice notice--bad" role="alert">
          {missing ? 'We couldn’t find that look.' : look.error.message} <Link to="/looks">All looks</Link>
        </p>
      </div>
    );
  }
  const l = look.data;
  const inStock = l.spots.filter((s) => s.product.inStock);
  return (
    <div className="page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/looks">Shop the Look</Link>
      </nav>
      <div className="look">
        <figure className="look__media">
          <img src={l.image} alt={l.title} width="800" height="1000" />
          {l.spots
            .filter((s) => s.x !== null && s.y !== null)
            .map((s, i) => (
              <Link
                key={s.product.id}
                to={`/shop/${s.product.id}`}
                className="look__spot"
                style={{ left: `${s.x}%`, top: `${s.y}%` }}
                aria-label={`Piece ${i + 1}: ${s.product.name}`}
              >
                {i + 1}
              </Link>
            ))}
        </figure>
        <div className="look__body">
          <h1 className="h1--small">{l.title}</h1>
          {l.description && <p className="lede lede--small">{l.description}</p>}
          <p className="price">
            <strong>{formatMoney(l.totalCents)}</strong> <span className="muted small">for one of each piece</span>
          </p>
          <AddSet
            items={inStock.map((s) => ({ productId: s.product.id, quantity: 1 }))}
            label={inStock.length === l.spots.length ? 'Add the whole look' : `Add the ${inStock.length} pieces in stock`}
          />
        </div>
      </div>
      <section className="row" aria-labelledby="look-pieces">
        <div className="section-head">
          <h2 id="look-pieces">In this look</h2>
        </div>
        <div className="products products--four">
          {l.spots.map((s) => (
            <ProductCard key={s.product.id} product={s.product} />
          ))}
        </div>
      </section>
    </div>
  );
}
