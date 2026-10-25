import { MotionConfig } from 'framer-motion';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useCart } from '../cart/CartContext';

export function Layout() {
  const { user, signOut } = useAuth();
  const { itemCount } = useCart();
  return (
    <MotionConfig reducedMotion="user">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="banner" role="note">
        Portfolio demo · checkout is simulated · no payment is ever taken and no card details are collected
      </div>
      <header className="header">
        <Link to="/" className="brand" aria-label="Atelier Noor home">
          Atelier <em>Noor</em>
        </Link>
        <nav aria-label="Primary">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/shop">Shop</NavLink>
          <NavLink to="/about">About this build</NavLink>
          <NavLink to="/cart">
            Cart{itemCount > 0 && <span className="badge" aria-label={`${itemCount} items`}>{itemCount}</span>}
          </NavLink>
          {user && <NavLink to="/orders">Orders</NavLink>}
          {user ? (
            <button type="button" className="link link--nav" onClick={() => void signOut()}>
              Sign out ({user.name})
            </button>
          ) : (
            <NavLink to="/login">Sign in</NavLink>
          )}
        </nav>
      </header>
      <main id="main">
        <Outlet />
      </main>
      <footer className="footer">
        <span>© Atelier Noor — a portfolio project by heba.dev</span>
        <span>Simulated checkout · synthetic data only</span>
      </footer>
    </MotionConfig>
  );
}
