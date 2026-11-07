import { useState } from 'react';
import { Link } from 'react-router-dom';
import { createMoodboard, getMoodboards, type Moodboard, pinToMoodboard } from '../api/client';
import { useAuth } from '../auth/AuthContext';

/** Customers pin a product to one of their moodboards, or start a new one. */
export function SaveToMoodboard({ productId }: { productId: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [boards, setBoards] = useState<Moodboard[] | null>(null);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  if (user?.role !== 'CUSTOMER') return null;

  const toggle = async () => {
    setOpen(!open);
    setMessage(null);
    if (!open && boards === null) {
      try {
        setBoards(await getMoodboards());
      } catch (e) {
        setMessage({ ok: false, text: e instanceof Error ? e.message : 'Could not load your moodboards' });
      }
    }
  };
  const pin = async (board: Moodboard) => {
    try {
      const updated = await pinToMoodboard(board.id, productId);
      setBoards((b) => (b ?? []).map((x) => (x.id === updated.id ? updated : x)));
      setMessage({ ok: true, text: `Saved to “${board.name}”.` });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'Could not save' });
    }
  };
  const create = async () => {
    if (!name.trim()) return;
    try {
      const board = await createMoodboard(name.trim());
      setBoards((b) => [board, ...(b ?? [])]);
      setName('');
      await pin(board);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'Could not create the moodboard' });
    }
  };
  return (
    <div className="moodboard-pick">
      <button type="button" className="btn btn--ghost" aria-expanded={open} onClick={() => void toggle()}>
        Save to moodboard
      </button>
      {open && (
        <div className="moodboard-pick__panel">
          {boards === null && !message && <p className="muted small">Loading…</p>}
          {boards && boards.length > 0 && (
            <ul>
              {boards.map((b) => {
                const pinned = b.productIds.includes(productId);
                return (
                  <li key={b.id}>
                    <button type="button" className="link" disabled={pinned} onClick={() => void pin(b)}>
                      {b.name}
                    </button>
                    {pinned && <span className="muted small"> · saved</span>}
                  </li>
                );
              })}
            </ul>
          )}
          <form
            className="moodboard-pick__new"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <label className="sr-only" htmlFor={`new-board-${productId}`}>
              New moodboard name
            </label>
            <input id={`new-board-${productId}`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="New moodboard" />
            <button type="submit" className="btn btn--small">
              Create
            </button>
          </form>
          {message && (
            <p className={message.ok ? 'small' : 'error-text'} role={message.ok ? 'status' : 'alert'}>
              {message.text} {message.ok && <Link to="/moodboards">Your moodboards</Link>}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
