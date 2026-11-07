import { Link } from 'react-router-dom';
import type { Look } from '../api/client';

export function LookCard({ look }: { look: Look }) {
  return (
    <article className="look-card">
      <Link to={`/looks/${look.slug}`} className="look-card__media" aria-label={`Shop the look: ${look.title}`}>
        <img src={look.image} alt="" width="600" height="750" loading="lazy" />
      </Link>
      <h3>
        <Link to={`/looks/${look.slug}`}>{look.title}</Link>
      </h3>
      <p className="muted small">
        {look.spots.length} {look.spots.length === 1 ? 'piece' : 'pieces'}
      </p>
    </article>
  );
}
