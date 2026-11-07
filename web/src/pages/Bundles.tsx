import { getBundles } from '../api/client';
import { BundleCard } from '../collections/BundleCard';
import { useRemote } from '../hooks/useRemote';

export function Bundles() {
  const bundles = useRemote((s) => getBundles({}, s), 'bundles');
  return (
    <div className="page">
      <header className="page__head">
        <p className="eyebrow">Sets</p>
        <h1 className="h1--small">Better together</h1>
        <p className="lede lede--small">Pieces chosen to go together, for less. The saving is worked out in your cart whenever it holds the full set.</p>
      </header>
      {bundles.phase === 'loading' && <p className="muted">Loading sets…</p>}
      {bundles.phase === 'error' && (
        <p className="notice notice--bad" role="alert">
          Sets are unavailable right now ({bundles.error.message}).
        </p>
      )}
      {bundles.phase === 'ready' &&
        (bundles.data.length === 0 ? (
          <p className="notice">No sets available right now.</p>
        ) : (
          <div className="bundles">
            {bundles.data.map((b) => (
              <BundleCard key={b.id} bundle={b} />
            ))}
          </div>
        ))}
    </div>
  );
}
