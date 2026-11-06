import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Product } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useCart } from '../cart/CartContext';
import { formatMoney } from '../lib/money';
import { useShopper } from '../shopper/ShopperContext';

export function WishButton({ product, withLabel = false }: { product: Product; withLabel?: boolean }) {
  const { isWished, toggleWish } = useShopper();
  const [error, setError] = useState(false);
  const on = isWished(product.id);
  const label = on ? `Remove ${product.name} from your wishlist` : `Save ${product.name} to your wishlist`;
  return (
    <button
      type="button"
      className={withLabel ? 'btn btn--ghost wish wish--labelled' : 'wish'}
      aria-pressed={on}
      aria-label={withLabel ? undefined : label}
      title={error ? 'Could not update the wishlist' : label}
      onClick={() => {
        setError(false);
        toggleWish(product.id).catch(() => setError(true));
      }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z" />
      </svg>
      {withLabel && <span>{on ? 'Saved to wishlist' : 'Save to wishlist'}</span>}
    </button>
  );
}

function QuickAdd({ product }: { product: Product }) {
  const { user } = useAuth();
  const { add } = useCart();
  const navigate = useNavigate();
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  if (!product.inStock || user?.role === 'DEMO_VIEWER' || user?.role === 'ADMIN') return null;
  const click = async () => {
    if (!user) {
      navigate('/login', { state: { from: `/shop/${product.id}` } });
      return;
    }
    setState('busy');
    try {
      await add(product.id, 1);
      setState('done');
      window.setTimeout(() => setState('idle'), 1800);
    } catch {
      setState('error');
    }
  };
  return (
    <button type="button" className="quick-add" onClick={click} disabled={state === 'busy'} aria-label={`Add ${product.name} to cart`}>
      {state === 'busy' ? 'Adding…' : state === 'done' ? 'Added ✓' : state === 'error' ? 'Try again' : 'Quick add'}
    </button>
  );
}

export function ProductCard({ product }: { product: Product }) {
  const discounted = product.discountPercent > 0;
  return (
    <article className="product" data-soldout={!product.inStock}>
      <div className="product__frame">
        <Link to={`/shop/${product.id}`} className="product__media" aria-label={`View ${product.name}`}>
          <img src={product.images[0]} alt="" loading="lazy" width="400" height="500" />
          {!product.inStock && <span className="tag tag--muted">Sold out</span>}
          {product.inStock && discounted && <span className="tag">−{product.discountPercent}%</span>}
        </Link>
        <WishButton product={product} />
        <QuickAdd product={product} />
      </div>
      <div className="product__body">
        {product.brand && <p className="product__brand">{product.brand.name}</p>}
        <h3>
          <Link to={`/shop/${product.id}`}>{product.name}</Link>
        </h3>
        <p className="price">
          <strong>{formatMoney(product.salePriceCents, product.currency)}</strong>
          {discounted && <s aria-label="original price">{formatMoney(product.priceCents, product.currency)}</s>}
        </p>
      </div>
    </article>
  );
}

export function ProductSkeletons({ count = 4 }: { count?: number }) {
  return (
    <div className="products" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="product product--skeleton">
          <div className="product__media" />
          <div className="product__body">
            <span className="bar" />
            <span className="bar bar--short" />
          </div>
        </div>
      ))}
    </div>
  );
}
