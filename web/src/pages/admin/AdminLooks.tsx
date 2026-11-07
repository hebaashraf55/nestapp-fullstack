import { type FormEvent, useState } from 'react';
import { createLook, deleteLook, getLooks, type Look, type Product, updateLook } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useRemote } from '../../hooks/useRemote';
import { ProductPicker } from './ProductPicker';
import { RemoteView } from './RemoteView';

const IMAGE = /^(https:\/\/[^\s#]+|\/[A-Za-z0-9][A-Za-z0-9_\-./]{0,300}\.(svg|png|jpe?g|webp|avif))$/;

function LookForm({ onSaved }: { onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState('');
  const [picked, setPicked] = useState<Pick<Product, 'id' | 'name'>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 3) return setError('Give the look a title of at least 3 characters.');
    if (!IMAGE.test(image.trim()) || image.includes('..')) return setError('The photo must be an https:// URL or a site path like /catalogue/name.jpg.');
    if (picked.length < 1 || picked.length > 8) return setError('A look has 1 to 8 products.');
    setBusy(true);
    setError(null);
    try {
      await createLook({
        title: title.trim(),
        description: description.trim(),
        image: image.trim(),
        spots: picked.map((p) => ({ productId: p.id, x: null, y: null })),
        active: true,
      });
      setTitle('');
      setDescription('');
      setImage('');
      setPicked([]);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form card-row card-row--stack" onSubmit={submit} noValidate>
      <h2>New look</h2>
      <label className="field">
        <span>Title</span>
        <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>Photo</span>
        <input value={image} onChange={(e) => setImage(e.target.value)} placeholder="/catalogue/live-edge-coffee-table.jpg" />
      </label>
      <label className="field">
        <span>Description</span>
        <input value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <ul className="picked" aria-label="Products in this look">
        {picked.map((p) => (
          <li key={p.id}>
            <span>{p.name}</span>
            <button type="button" className="link" onClick={() => setPicked(picked.filter((x) => x.id !== p.id))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      {picked.length < 8 && <ProductPicker exclude={picked.map((p) => p.id)} onPick={(p) => setPicked([...picked, p])} />}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn" disabled={busy}>
        {busy ? 'Saving…' : 'Create look'}
      </button>
    </form>
  );
}

export function AdminLooks() {
  const { user } = useAuth();
  const admin = user?.role === 'ADMIN';
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const looks = useRemote((s) => getLooks({ all: admin }, s), `admin-looks:${version}`);
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
  };
  return (
    <>
      {error && (
        <p className="notice notice--bad" role="alert">
          {error}
        </p>
      )}
      <RemoteView state={looks}>
        {(list: Look[]) =>
          list.length === 0 ? (
            <p className="notice">No looks yet.</p>
          ) : (
            <ul className="moderation">
              {list.map((l) => (
                <li key={l.id} className="card-row">
                  <div className="card-row__media">
                    <img src={l.image} alt="" width="72" height="90" />
                    <div>
                      <h3>{l.title}</h3>
                      <p className="muted small">{l.spots.map((s) => s.product.name).join(' · ')}</p>
                    </div>
                  </div>
                  <div className="moderation__actions">
                    <span className="pill" data-status={l.active ? 'APPROVED' : 'REJECTED'}>
                      {l.active ? 'active' : 'hidden'}
                    </span>
                    {admin && (
                      <>
                        <button type="button" className="btn btn--ghost btn--small" onClick={() => void act(() => updateLook(l.id, { active: !l.active }))}>
                          {l.active ? 'Hide' : 'Show'}
                        </button>
                        <button
                          type="button"
                          className="btn btn--danger btn--small"
                          onClick={() => {
                            if (window.confirm(`Delete the look “${l.title}”?`)) void act(() => deleteLook(l.id));
                          }}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </RemoteView>
      {admin && <LookForm onSaved={() => setVersion((v) => v + 1)} />}
    </>
  );
}
