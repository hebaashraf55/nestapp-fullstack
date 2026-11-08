import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSuggestions, type Suggestions } from '../api/client';
import { formatMoney } from '../lib/money';

/** Products and categories that match what is being typed (after a short pause). */
export function SearchSuggestions({ text }: { text: string }) {
  const q = text.trim();
  const [data, setData] = useState<{ q: string; result: Suggestions } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(false);
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      getSuggestions(q, controller.signal)
        .then((result) => setData({ q, result }))
        .catch(() => undefined);
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDismissed(true);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (dismissed || q.length < 2 || !data || data.q !== q) return null;
  const { products, categories } = data.result;
  if (products.length === 0 && categories.length === 0) return null;
  return (
    <ul id="search-suggestions" className="suggest" aria-label="Suggestions">
      {categories.map((c) => (
        <li key={c.id}>
          <Link to={`/shop?category=${c.id}`} onClick={() => setDismissed(true)}>
            <span className="muted small">Category</span> {c.name}
          </Link>
        </li>
      ))}
      {products.map((p) => (
        <li key={p.id}>
          <Link to={`/shop/${p.id}`} onClick={() => setDismissed(true)}>
            {p.image && <img src={p.image} alt="" width="32" height="40" />}
            <span>{p.name}</span>
            <span className="muted small">{formatMoney(p.salePriceCents, p.currency)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
