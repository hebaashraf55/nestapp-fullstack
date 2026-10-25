import { type FormEvent, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  getBrands,
  getCategories,
  getProducts,
  type ProductQuery,
  type ProductSort,
} from '../api/client';
import { ProductCard, ProductSkeletons } from '../components/ProductCard';
import { useRemote } from '../hooks/useRemote';

const SORTS: { value: ProductSort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'name', label: 'Name' },
];
const PAGE_SIZE = 8;

const toCents = (dollars: string | null): number | undefined => {
  if (!dollars) return undefined;
  const n = Number(dollars);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
};

/** The URL is the single source of truth for filters, so results can be bookmarked and shared. */
export function Shop() {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const sort = (SORTS.some((s) => s.value === get('sort')) ? get('sort') : 'newest') as ProductSort;
  const page = Math.max(1, Math.floor(Number(get('page'))) || 1);

  const query: ProductQuery = {
    q: get('q') || undefined,
    categoryId: get('category') || undefined,
    brandId: get('brand') || undefined,
    minPrice: toCents(params.get('min')),
    maxPrice: toCents(params.get('max')),
    inStock: get('stock') === '1' ? true : undefined,
    sort,
    page,
    limit: PAGE_SIZE,
  };

  const categories = useRemote((s) => getCategories(s), 'categories');
  const brands = useRemote((s) => getBrands(s), 'brands');
  const products = useRemote((s) => getProducts(query, s), params.toString());

  const [search, setSearch] = useState(get('q'));
  const [min, setMin] = useState(get('min'));
  const [max, setMax] = useState(get('max'));

  const update = (changes: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (resetPage) next.delete('page');
    setParams(next);
  };
  const apply = (e: FormEvent) => {
    e.preventDefault();
    update({ q: search.trim() || null, min: min || null, max: max || null });
  };
  const clear = () => {
    setSearch('');
    setMin('');
    setMax('');
    setParams(new URLSearchParams());
  };
  const hasFilters = ['q', 'category', 'brand', 'min', 'max', 'stock'].some((k) => params.has(k));

  return (
    <div className="page">
      <header className="page__head">
        <p className="eyebrow">The collection</p>
        <h1 className="h1--small">Shop</h1>
      </header>

      <form className="filters" onSubmit={apply} role="search" aria-label="Filter products">
        <label className="field field--grow">
          <span>Search</span>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={80} placeholder="Vase, throw, lamp…" />
        </label>
        <label className="field">
          <span>Category</span>
          <select value={get('category')} onChange={(e) => update({ category: e.target.value || null })}>
            <option value="">All categories</option>
            {categories.phase === 'ready' &&
              categories.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>Brand</span>
          <select value={get('brand')} onChange={(e) => update({ brand: e.target.value || null })}>
            <option value="">All brands</option>
            {brands.phase === 'ready' &&
              brands.data.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field field--narrow">
          <span>Min $</span>
          <input type="number" inputMode="decimal" min="0" step="1" value={min} onChange={(e) => setMin(e.target.value)} />
        </label>
        <label className="field field--narrow">
          <span>Max $</span>
          <input type="number" inputMode="decimal" min="0" step="1" value={max} onChange={(e) => setMax(e.target.value)} />
        </label>
        <label className="field">
          <span>Sort</span>
          <select value={sort} onChange={(e) => update({ sort: e.target.value === 'newest' ? null : e.target.value })}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={get('stock') === '1'} onChange={(e) => update({ stock: e.target.checked ? '1' : null })} />
          In stock only
        </label>
        <div className="filters__actions">
          <button type="submit" className="btn">
            Apply
          </button>
          {hasFilters && (
            <button type="button" className="btn btn--ghost" onClick={clear}>
              Clear all
            </button>
          )}
        </div>
      </form>

      <section aria-live="polite" aria-busy={products.phase === 'loading'}>
        {products.phase === 'loading' && <ProductSkeletons count={PAGE_SIZE} />}
        {products.phase === 'error' && (
          <div className="notice notice--bad" role="alert">
            <strong>We couldn’t load the collection.</strong> {products.error.message}.{' '}
            <button type="button" className="link" onClick={() => setParams(new URLSearchParams(params))}>
              Try again
            </button>
          </div>
        )}
        {products.phase === 'ready' && products.data.items.length === 0 && (
          <div className="notice">
            <strong>{hasFilters ? 'Nothing matches those filters.' : 'The catalogue is empty.'}</strong>{' '}
            {hasFilters
              ? 'Try widening the price range or clearing a filter.'
              : 'Run the catalogue seed (npm run seed:catalogue) or add products as an admin.'}
          </div>
        )}
        {products.phase === 'ready' && products.data.items.length > 0 && (
          <>
            <p className="count">
              {products.data.total} {products.data.total === 1 ? 'piece' : 'pieces'}
            </p>
            <div className="products">
              {products.data.items.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
            {products.data.totalPages > 1 && (
              <nav className="pager" aria-label="Pagination">
                <button className="btn btn--ghost" disabled={page <= 1} onClick={() => update({ page: String(page - 1) }, false)}>
                  Previous
                </button>
                <span>
                  Page {products.data.page} of {products.data.totalPages}
                </span>
                <button
                  className="btn btn--ghost"
                  disabled={page >= products.data.totalPages}
                  onClick={() => update({ page: String(page + 1) }, false)}
                >
                  Next
                </button>
              </nav>
            )}
          </>
        )}
      </section>
    </div>
  );
}
