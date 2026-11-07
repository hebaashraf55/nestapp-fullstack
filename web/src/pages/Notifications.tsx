import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { formatDate } from '../lib/orderText';
import { useNotifications } from '../notifications/NotificationsContext';

export function Notifications() {
  const { user } = useAuth();
  const { items, unread, markRead, markAll } = useNotifications();
  const navigate = useNavigate();
  if (user?.role !== 'CUSTOMER')
    return (
      <div className="page">
        <p className="notice">
          {user ? 'Notifications are for customer accounts.' : <><Link to="/login" state={{ from: '/notifications' }}>Sign in</Link> to see your notifications.</>}
        </p>
      </div>
    );
  return (
    <div className="page page--narrow">
      <header className="page__head">
        <p className="eyebrow">Updates</p>
        <h1 className="h1--small">Notifications</h1>
      </header>
      {unread > 0 && (
        <button type="button" className="link" onClick={() => void markAll()}>
          Mark all as read
        </button>
      )}
      {items.length === 0 ? (
        <p className="notice">Nothing yet. We’ll let you know when an order ships, a return is decided or a review is published.</p>
      ) : (
        <ul className="notes">
          {items.map((n) => (
            <li key={n.id} data-read={n.read}>
              <button
                type="button"
                className="notes__item"
                onClick={() => {
                  void markRead(n.id).catch(() => undefined);
                  if (n.link) navigate(n.link);
                }}
              >
                <strong>{n.title}</strong>
                {n.body && <span className="muted small">{n.body}</span>}
                <span className="muted small">{formatDate(n.createdAt)}</span>
                {!n.read && <span className="sr-only">(unread)</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
