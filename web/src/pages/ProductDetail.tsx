import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, getProduct } from '../api/client';
import { AddToCart } from '../components/AddToCart';
import { useRemote } from '../hooks/useRemote';
import { formatMoney } from '../lib/money';

export function ProductDetail() {
  const { id = '' } = useParams();
  const product = useRemote((s) => getProduct(id, s), id);
  const [selected, setSelected] = useState(0);

  if (product.phase === 'loading') {
    return (
      <div className="page detail detail--loading" aria-busy="true">
        <div className="detail__media product--skeleton" />
        <div className="detail__body">
          <span className="bar" />
          <span className="bar bar--short" />
        </div>
      </div>
    );
  }
  if (product.phase === 'error') {
    const missing = product.error instanceof ApiError && [400, 404].includes(product.error.statusCode);
    return (
      <div className="page">
        <div className="notice notice--bad" role="alert">
          <strong>{missing ? 'We couldn’t find that piece.' : 'We couldn’t load this piece.'}</strong>{' '}
          {missing ? 'It may have been removed.' : product.error.message}{' '}
          <Link to="/shop">Back to the shop</Link>
        </div>
      </div>
    );
  }

  const p = product.data;
  const discounted = p.discountPercent > 0;
  return (
    <div className="page detail">
      <div className="detail__media">
        <img src={p.images[selected] ?? p.images[0]} alt={p.name} width="400" height="500" />
        {p.images.length > 1 && (
          <ul className="thumbs" aria-label="Product images">
            {p.images.map((src, i) => (
              <li key={src}>
                <button type="button" aria-label={`Show image ${i + 1}`} aria-pressed={i === selected} onClick={() => setSelected(i)}>
                  <img src={src} alt="" width="64" height="80" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="detail__body">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link to="/shop">Shop</Link>
          {p.category && (
            <>
              <span aria-hidden="true">/</span>
              <Link to={`/shop?category=${p.category.id}`}>{p.category.name}</Link>
            </>
          )}
        </nav>
        {p.brand && (
          <p className="product__brand">
            <Link to={`/shop?brand=${p.brand.id}`}>{p.brand.name}</Link>
          </p>
        )}
        <h1 className="h1--small">{p.name}</h1>
        <p className="price price--large">
          <strong>{formatMoney(p.salePriceCents, p.currency)}</strong>
          {discounted && (
            <>
              <s aria-label="original price">{formatMoney(p.priceCents, p.currency)}</s>
              <span className="tag tag--inline">−{p.discountPercent}%</span>
            </>
          )}
        </p>
        <p className="stock" data-instock={p.inStock}>
          {!p.inStock ? 'Sold out' : p.stock <= 5 ? `Only ${p.stock} left` : 'In stock'}
        </p>
        {p.description && <p className="lede lede--small">{p.description}</p>}
        <AddToCart product={p} />
        <p className="notice">
          Checkout is simulated. No payment is ever taken.
        </p>
      </div>
    </div>
  );
}
