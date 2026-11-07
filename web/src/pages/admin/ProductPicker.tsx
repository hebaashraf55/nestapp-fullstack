import { useState } from 'react';
import { getProducts, type Product } from '../../api/client';
import { useRemote } from '../../hooks/useRemote';

/** Search the catalogue and pick a product (admins building sets and looks). */
export function ProductPicker({ onPick, exclude }: { onPick: (p: Product) => void; exclude: string[] }) {
  const [q, setQ] = useState('');
  const results = useRemote((s) => getProducts({ q: q.trim() || undefined, limit: 8 }, s), `pick:${q.trim()}`);
  return (
    <div className="picker">
      <label className="field">
        <span>Find a product</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, material, category…" />
      </label>
      {results.phase === 'ready' && (
        <ul className="picker__results">
          {results.data.items.map((p) => (
            <li key={p.id}>
              <button type="button" className="link" disabled={exclude.includes(p.id)} onClick={() => onPick(p)}>
                {p.name}
              </button>
              <span className="muted small"> · {p.category?.name ?? '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
