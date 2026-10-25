import { Link } from 'react-router-dom';
import type { Product } from '../api/client';
import { formatMoney } from '../lib/money';

export function ProductCard({ product }: { product: Product }) {
  const discounted = product.discountPercent > 0;
  return (
    <article className="product" data-soldout={!product.inStock}>
      <Link to={`/shop/${product.id}`} className="product__media" aria-label={`View ${product.name}`}>
        <img src={product.images[0]} alt="" loading="lazy" width="400" height="500" />
        {!product.inStock && <span className="tag tag--muted">Sold out</span>}
        {product.inStock && discounted && <span className="tag">−{product.discountPercent}%</span>}
      </Link>
      <div className="product__body">
        {product.brand && <p className="product__brand">{product.brand.name}</p>}
        <h3>
          <Link to={`/shop/${product.id}`}>{product.name}</Link>
        </h3>
        <p className="price">
          <strong>{formatMoney(product.salePriceCents, product.currency)}</strong>
          {discounted && (
            <s aria-label="original price">{formatMoney(product.priceCents, product.currency)}</s>
          )}
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
