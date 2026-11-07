import { type FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ApiError,
  createMoodboard,
  deleteMoodboard,
  getMoodboard,
  getMoodboards,
  getSharedMoodboard,
  type Moodboard,
  shareMoodboard,
  unpinFromMoodboard,
  unshareMoodboard,
  updateMoodboard,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ProductCard } from '../components/ProductCard';
import { useRemote } from '../hooks/useRemote';

function CustomersOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user)
    return (
      <div className="page">
        <p className="notice">
          <Link to="/login" state={{ from: location.pathname }}>
            Sign in
          </Link>{' '}
          to keep moodboards.
        </p>
      </div>
    );
  if (user.role !== 'CUSTOMER')
    return (
      <div className="page">
        <p className="notice">Moodboards are for customer accounts.</p>
      </div>
    );
  return <>{children}</>;
}

export function Moodboards() {
  return (
    <CustomersOnly>
      <BoardList />
    </CustomersOnly>
  );
}

function BoardList() {
  const [version, setVersion] = useState(0);
  const boards = useRemote((s) => getMoodboards(s), `boards:${version}`);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError('Give the moodboard a name.');
    try {
      await createMoodboard(name.trim());
      setName('');
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };
  return (
    <div className="page">
      <header className="page__head">
        <p className="eyebrow">Ideas</p>
        <h1 className="h1--small">Moodboards</h1>
        <p className="lede lede--small">Collect pieces for a room. Boards are private until you share a link.</p>
      </header>
      <form className="inline-form" onSubmit={create} noValidate>
        <label className="field">
          <span>New moodboard</span>
          <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Calm bedroom" />
        </label>
        <button type="submit" className="btn">
          Create
        </button>
      </form>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {boards.phase === 'error' && (
        <p className="notice notice--bad" role="alert">
          {boards.error.message}
        </p>
      )}
      {boards.phase === 'ready' &&
        (boards.data.length === 0 ? (
          <p className="notice">No moodboards yet. Create one, then use “Save to moodboard” on any product.</p>
        ) : (
          <ul className="boards">
            {boards.data.map((b) => (
              <li key={b.id}>
                <Link to={`/moodboards/${b.id}`} className="board-tile">
                  <span className="board-tile__grid" aria-hidden="true">
                    {b.products.slice(0, 4).map((p) => (
                      <img key={p.id} src={p.images[0]} alt="" width="120" height="150" loading="lazy" />
                    ))}
                  </span>
                  <strong>{b.name}</strong>
                  <span className="muted small">
                    {b.products.length} {b.products.length === 1 ? 'piece' : 'pieces'}
                    {b.sharePath ? ' · shared' : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

export function MoodboardDetail() {
  return (
    <CustomersOnly>
      <Board />
    </CustomersOnly>
  );
}

function Board() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const loaded = useRemote((s) => getMoodboard(id, s), id);
  const [board, setBoard] = useState<Moodboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (loaded.phase === 'loading') return <div className="page muted">Loading…</div>;
  if (loaded.phase === 'error')
    return (
      <div className="page">
        <p className="notice notice--bad" role="alert">
          {loaded.error instanceof ApiError && [400, 404].includes(loaded.error.statusCode) ? 'We couldn’t find that moodboard.' : loaded.error.message}{' '}
          <Link to="/moodboards">Your moodboards</Link>
        </p>
      </div>
    );
  const b = board ?? loaded.data;
  const act = async (fn: () => Promise<Moodboard>) => {
    setError(null);
    try {
      setBoard(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
  };
  const link = b.sharePath ? `${window.location.origin}${b.sharePath}` : null;
  return (
    <div className="page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/moodboards">Moodboards</Link>
      </nav>
      <header className="page__head">
        <h1 className="h1--small">{b.name}</h1>
        {b.note && <p className="lede lede--small">{b.note}</p>}
      </header>
      <div className="board-actions">
        <button
          type="button"
          className="link"
          onClick={() => {
            const name = window.prompt('Rename moodboard', b.name)?.trim();
            if (name && name !== b.name) void act(() => updateMoodboard(b.id, { name }));
          }}
        >
          Rename
        </button>
        {link ? (
          <>
            <span className="share-link">
              <span className="muted small">Anyone with this link can view it:</span>{' '}
              <a href={link}>{link}</a>
            </span>
            <button
              type="button"
              className="link"
              onClick={() => {
                void navigator.clipboard?.writeText(link).then(() => setCopied(true));
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <button type="button" className="link" onClick={() => void act(() => unshareMoodboard(b.id))}>
              Stop sharing
            </button>
          </>
        ) : (
          <button type="button" className="link" onClick={() => void act(() => shareMoodboard(b.id))}>
            Create share link
          </button>
        )}
        <button
          type="button"
          className="link link--danger"
          onClick={() => {
            if (window.confirm(`Delete “${b.name}”?`))
              void deleteMoodboard(b.id)
                .then(() => navigate('/moodboards'))
                .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not delete'));
          }}
        >
          Delete
        </button>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {b.products.length === 0 ? (
        <p className="notice">
          Nothing pinned yet. Use “Save to moodboard” on a product page. <Link to="/shop">Browse the shop</Link>
        </p>
      ) : (
        <div className="products products--four">
          {b.products.map((p) => (
            <div key={p.id} className="pinned">
              <ProductCard product={p} />
              <button type="button" className="link small" onClick={() => void act(() => unpinFromMoodboard(b.id, p.id))}>
                Remove from board
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SharedMoodboard() {
  const { token = '' } = useParams();
  const board = useRemote((s) => getSharedMoodboard(token, s), token);
  return (
    <div className="page">
      {board.phase === 'loading' && <p className="muted">Loading…</p>}
      {board.phase === 'error' && (
        <p className="notice notice--bad" role="alert">
          This moodboard link is not valid or is no longer shared. <Link to="/shop">Browse the shop</Link>
        </p>
      )}
      {board.phase === 'ready' && (
        <>
          <header className="page__head">
            <p className="eyebrow">A shared moodboard</p>
            <h1 className="h1--small">{board.data.name}</h1>
            {board.data.note && <p className="lede lede--small">{board.data.note}</p>}
          </header>
          {board.data.products.length === 0 ? (
            <p className="notice">This moodboard is empty.</p>
          ) : (
            <div className="products products--four">
              {board.data.products.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
