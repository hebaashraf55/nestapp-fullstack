import { Link } from 'react-router-dom';
import type { Bundle } from '../api/client';
import { formatMoney } from '../lib/money';
import { AddSet } from './AddSet';

export function BundleCard({ bundle, currency = 'USD' }: { bundle: Bundle; currency?: string }) {
  const items = bundle.items.filter((i) => i.product !== null);
  return (
    <article className="bundle" aria-labelledby={`bundle-${bundle.id}`}>
      <ul className="bundle__items" aria-label="In this set">
        {items.map((i) => (
          <li key={i.product!.id}>
            <Link to={`/shop/${i.product!.id}`}>
              <img src={i.product!.images[0]} alt="" width="96" height="120" loading="lazy" />
              <span>
                {i.quantity > 1 ? `${i.quantity} × ` : ''}
                {i.product!.name}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="bundle__body">
        <h3 id={`bundle-${bundle.id}`}>{bundle.name}</h3>
        {bundle.description && <p className="muted">{bundle.description}</p>}
        <p className="price">
          <strong>{formatMoney(bundle.priceCents, currency)}</strong>
          <s aria-label="price of the items separately">{formatMoney(bundle.itemsTotalCents, currency)}</s>
          <span className="tag tag--inline">Save {formatMoney(bundle.savingsCents, currency)}</span>
        </p>
        {bundle.available ? (
          <AddSet items={items.map((i) => ({ productId: i.product!.id, quantity: i.quantity }))} label="Add the set" />
        ) : (
          <p className="muted small">Not all pieces are in stock right now.</p>
        )}
        <p className="muted small">The {bundle.discountPercent}% set discount is applied in your cart while it holds the whole set.</p>
      </div>
    </article>
  );
}
