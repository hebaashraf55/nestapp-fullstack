import { Link } from 'react-router-dom';
import { getProducts } from '../api/client';
import { useRemote } from '../hooks/useRemote';
import { ProductCard, ProductSkeletons } from './ProductCard';

/** Newest pieces straight from GET /api/product. Shows an honest empty/error state, never filler. */
export function Featured() {
  const featured = useRemote((s) => getProducts({ sort: 'newest', limit: 4 }, s), 'featured');
  return (
    <section className="featured" aria-labelledby="featured-title">
      <div className="featured__head">
        <h2 id="featured-title">New arrivals</h2>
        <Link to="/shop">View all</Link>
      </div>
      {featured.phase === 'loading' && <ProductSkeletons />}
      {featured.phase === 'error' && (
        <p className="notice notice--bad" role="alert">
          The catalogue is unavailable right now ({featured.error.message}).
        </p>
      )}
      {featured.phase === 'ready' && featured.data.items.length === 0 && (
        <p className="notice">No products yet. Run the catalogue seed or add some as an admin.</p>
      )}
      {featured.phase === 'ready' && featured.data.items.length > 0 && (
        <div className="products">
          {featured.data.items.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </section>
  );
}
