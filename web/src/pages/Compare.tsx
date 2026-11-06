import { Link } from 'react-router-dom';
import { compareProducts, type Product } from '../api/client';
import { useRemote } from '../hooks/useRemote';
import { formatMoney } from '../lib/money';
import { COMPARE_MAX, useShopper } from '../shopper/ShopperContext';

const ROWS: { label: string; value: (p: Product) => string }[] = [
  { label: 'Price', value: (p) => formatMoney(p.salePriceCents, p.currency) + (p.discountPercent > 0 ? ` (−${p.discountPercent}%)` : '') },
  { label: 'Category', value: (p) => p.category?.name ?? '—' },
  { label: 'Maker', value: (p) => p.brand?.name ?? '—' },
  { label: 'Material', value: (p) => p.specs?.material ?? '—' },
  { label: 'Colour', value: (p) => p.specs?.color ?? '—' },
  { label: 'Dimensions', value: (p) => p.specs?.dimensions ?? '—' },
  { label: 'Care', value: (p) => p.specs?.care ?? '—' },
  { label: 'Availability', value: (p) => (!p.inStock ? 'Sold out' : p.stock <= 5 ? `Only ${p.stock} left` : 'In stock') },
];

function Table({ ids }: { ids: string[] }) {
  const { toggleCompare } = useShopper();
  const result = useRemote((s) => compareProducts(ids, s), ids.join(','));
  if (result.phase === 'loading') return <p className="notice">Loading the comparison…</p>;
  if (result.phase === 'error')
    return (
      <p className="notice notice--bad" role="alert">
        We couldn’t compare these pieces ({result.error.message}).
      </p>
    );
  const products = result.data;
  return (
    <div className="compare" role="region" aria-label="Comparison" tabIndex={0}>
      <table>
        <thead>
          <tr>
            <td />
            {products.map((p) => (
              <th key={p.id} scope="col">
                <Link to={`/shop/${p.id}`} className="compare__media">
                  <img src={p.images[0]} alt="" width="160" height="200" />
                </Link>
                <Link to={`/shop/${p.id}`} className="compare__name">
                  {p.name}
                </Link>
                <button type="button" className="link" onClick={() => toggleCompare(p.id)}>
                  Remove
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {products.map((p) => (
                <td key={p.id}>{row.value(p)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Compare() {
  const { compare, clearCompare } = useShopper();
  return (
    <div className="page">
      <header className="page__head">
        <p className="eyebrow">Side by side</p>
        <h1 className="h1--small">Compare</h1>
        <p className="lede lede--small">Choose up to {COMPARE_MAX} pieces with “Compare” on their product pages.</p>
      </header>
      {compare.length < 2 ? (
        <p className="notice">
          {compare.length === 0 ? 'Nothing to compare yet.' : 'Add one more piece to compare.'}{' '}
          <Link to="/shop">Browse the shop</Link>
        </p>
      ) : (
        <>
          <Table ids={compare} />
          <button type="button" className="btn btn--ghost btn--small" onClick={clearCompare}>
            Clear comparison
          </button>
        </>
      )}
    </div>
  );
}
