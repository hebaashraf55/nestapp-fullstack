import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, getBundles, getLooks, getProduct, type Product } from '../api/client';
import { BundleCard } from '../collections/BundleCard';
import { LookCard } from '../collections/LookCard';
import { SaveToMoodboard } from '../collections/SaveToMoodboard';
import { AddToCart } from '../components/AddToCart';
import { WishButton } from '../components/ProductCard';
import { ProductRow } from '../components/ProductRow';
import { Reviews } from '../reviews/Reviews';
import { useRemote } from '../hooks/useRemote';
import { formatMoney } from '../lib/money';
import { creditFor } from '../lib/photoCredits';
import { COMPARE_MAX, useShopper } from '../shopper/ShopperContext';
import { useProductsById } from '../shopper/useProducts';

function Specs({ specs }: { specs: NonNullable<Product['specs']> }) {
  const rows = (
    [
      ['Material', specs.material],
      ['Colour', specs.color],
      ['Dimensions', specs.dimensions],
      ['Care', specs.care],
    ] as const
  ).filter(([, v]) => v);
  if (rows.length === 0) return null;
  return (
    <dl className="specs">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function CompareButton({ id }: { id: string }) {
  const { compare, toggleCompare } = useShopper();
  const on = compare.includes(id);
  const full = !on && compare.length >= COMPARE_MAX;
  return (
    <button type="button" className="btn btn--ghost" aria-pressed={on} disabled={full} onClick={() => toggleCompare(id)} title={full ? `Compare holds ${COMPARE_MAX} pieces` : undefined}>
      {on ? 'Added to compare' : 'Compare'}
    </button>
  );
}

function Variants({ product }: { product: Product }) {
  if (!product.variants || product.variants.length < 2) return null;
  return (
    <fieldset className="variants">
      <legend>Options</legend>
      <ul>
        {product.variants.map((v) => (
          <li key={v.id}>
            <Link
              to={`/shop/${v.id}`}
              replace
              aria-current={v.id === product.id ? 'true' : undefined}
              data-soldout={!v.inStock}
              title={v.inStock ? v.label : `${v.label} (sold out)`}
            >
              {v.label}
              {!v.inStock && <span className="sr-only"> (sold out)</span>}
            </Link>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function CompleteTheSet({ productId, currency }: { productId: string; currency: string }) {
  const bundles = useRemote((s) => getBundles({ productId }, s), `bundles:${productId}`);
  if (bundles.phase !== 'ready' || bundles.data.length === 0) return null;
  return (
    <section className="row" aria-labelledby="sets-title">
      <div className="section-head">
        <h2 id="sets-title">Complete the set</h2>
      </div>
      <div className="bundles">
        {bundles.data.map((b) => (
          <BundleCard key={b.id} bundle={b} currency={currency} />
        ))}
      </div>
    </section>
  );
}

function InLooks({ productId }: { productId: string }) {
  const looks = useRemote((s) => getLooks({ productId }, s), `looks:${productId}`);
  if (looks.phase !== 'ready' || looks.data.length === 0) return null;
  return (
    <section className="row" aria-labelledby="in-looks-title">
      <div className="section-head">
        <h2 id="in-looks-title">Seen in these looks</h2>
        <Link to="/looks">All looks</Link>
      </div>
      <div className="looks">
        {looks.data.slice(0, 3).map((l) => (
          <LookCard key={l.id} look={l} />
        ))}
      </div>
    </section>
  );
}

function AlsoViewed({ current }: { current: string }) {
  const { recent } = useShopper();
  const { items } = useProductsById(recent.filter((x) => x !== current).slice(0, 4));
  return <ProductRow id="recently-viewed" title="Recently viewed" products={items} />;
}

export function ProductDetail() {
  const { id = '' } = useParams();
  const product = useRemote((s) => getProduct(id, s), id);
  const [selected, setSelected] = useState(0);
  const { recordView } = useShopper();
  const loadedId = product.phase === 'ready' ? product.data.id : null;
  useEffect(() => {
    if (loadedId) recordView(loadedId);
  }, [loadedId, recordView]);

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
  const shown = p.images[selected] ?? p.images[0];
  const credit = creditFor(shown);
  return (
    <>
    <div className="page detail">
      <div className="detail__media">
        <img src={shown} alt={p.name} width="400" height="500" />
        {credit && (
          <p className="credit">
            Photo:{' '}
            <a href={credit.url} target="_blank" rel="noreferrer">
              {credit.photographer}
            </a>{' '}
            on Unsplash
          </p>
        )}
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
        <Variants product={p} />
        <AddToCart product={p} />
        <div className="detail__actions">
          <WishButton product={p} withLabel />
          <CompareButton id={p.id} />
          <SaveToMoodboard productId={p.id} />
        </div>
        {p.specs && <Specs specs={p.specs} />}
        <p className="notice">
          Checkout is simulated. No payment is ever taken.
        </p>
      </div>
    </div>
    <div className="page detail__more">
      <CompleteTheSet productId={p.id} currency={p.currency} />
      <Reviews productId={p.id} />
      <InLooks productId={p.id} />
      <AlsoViewed current={p.id} />
    </div>
    </>
  );
}
