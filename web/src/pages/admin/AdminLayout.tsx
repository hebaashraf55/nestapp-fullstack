import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';

/**
 * Hiding the admin area from other roles is a courtesy only. The API enforces who may read or change
 * anything, so a customer who opens this URL gets this message and the server would refuse them anyway.
 */
export function AdminLayout() {
  const { user } = useAuth();
  if (!user) {
    return (
      <div className="page">
        <h1 className="h1--small">Admin</h1>
        <p className="notice">
          <Link to="/login" state={{ from: '/admin' }}>
            Sign in
          </Link>{' '}
          with a staff account to continue.
        </p>
      </div>
    );
  }
  if (user.role === 'CUSTOMER') {
    return (
      <div className="page">
        <h1 className="h1--small">Admin</h1>
        <p className="notice notice--bad" role="alert">
          This area is for staff accounts. Your account does not have access.
        </p>
      </div>
    );
  }
  const readOnly = user.role === 'DEMO_VIEWER';
  return (
    <div className="page">
      <header className="page__head">
        <p className="eyebrow">{readOnly ? 'Read-only demo view · synthetic data only' : 'Administration · simulated payments'}</p>
        <h1 className="h1--small">Admin</h1>
      </header>
      <nav className="subnav" aria-label="Admin sections">
        <NavLink to="/admin" end>
          Dashboard
        </NavLink>
        <NavLink to="/admin/orders">Orders</NavLink>
        <NavLink to="/admin/customers">Customers</NavLink>
        {!readOnly && <NavLink to="/admin/audit">Audit log</NavLink>}
      </nav>
      {readOnly && (
        <p className="notice">
          You are signed in as the demo viewer. You can look around, but you cannot change anything, and you only see
          synthetic records.
        </p>
      )}
      <Outlet />
    </div>
  );
}
