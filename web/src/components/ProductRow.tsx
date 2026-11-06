import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Product } from '../api/client';
import { ProductCard } from './ProductCard';

/** A titled row of products, four per line on wide screens. Renders nothing when empty. */
export function ProductRow({
  id,
  title,
  products,
  more,
  note,
}: {
  id: string;
  title: string;
  products: Product[];
  more?: { to: string; label: string };
  note?: ReactNode;
}) {
  if (products.length === 0) return null;
  return (
    <section className="row" id={id} aria-labelledby={`${id}-title`}>
      <div className="section-head">
        <h2 id={`${id}-title`}>{title}</h2>
        {more && <Link to={more.to}>{more.label}</Link>}
      </div>
      {note && <p className="row__note">{note}</p>}
      <div className="products products--four">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
