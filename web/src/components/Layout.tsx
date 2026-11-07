import { MotionConfig } from 'framer-motion';
import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useCart } from '../cart/CartContext';
import { useShopper } from '../shopper/ShopperContext';
import { ThemeToggle } from './ThemeToggle';

function CompareTray() {
  const { compare, clearCompare } = useShopper();
  const { pathname } = useLocation();
  if (compare.length === 0 || pathname === '/compare') return null;
  return (
    <aside className="tray" aria-label="Comparison">
      <span>
        {compare.length} {compare.length === 1 ? 'piece' : 'pieces'} to compare
      </span>
      <Link to="/compare" className="btn btn--small">
        Compare
      </Link>
      <button type="button" className="link" onClick={clearCompare}>
        Clear
      </button>
    </aside>
  );
}

/** BrowserRouter keeps the old scroll position on navigation; start each new page at the top. */
function useScrollToTopOnNavigate() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
}

export function Layout() {
  useScrollToTopOnNavigate();
  const { user, signOut } = useAuth();
  const { itemCount } = useCart();
  const { wishlist } = useShopper();
  return (
    <MotionConfig reducedMotion="user">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="banner" role="note">
        Portfolio demo · checkout is simulated · no payment is ever taken and no card details are collected
      </div>
      <header className="header">
        <Link to="/" className="brand" aria-label="NOMA home">
          NOMA
        </Link>
        <nav aria-label="Primary">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/shop">Shop</NavLink>
          <NavLink to="/looks">Looks</NavLink>
          <NavLink to="/sets">Sets</NavLink>
          <NavLink to="/about">About this build</NavLink>
          <NavLink to="/wishlist">
            Wishlist{wishlist.length > 0 && <span className="badge" aria-label={`${wishlist.length} saved`}>{wishlist.length}</span>}
          </NavLink>
          <NavLink to="/cart">
            Cart{itemCount > 0 && <span className="badge" aria-label={`${itemCount} items`}>{itemCount}</span>}
          </NavLink>
          {user?.role === 'CUSTOMER' && <NavLink to="/moodboards">Moodboards</NavLink>}
          {user && user.role !== 'DEMO_VIEWER' && user.role !== 'ADMIN' && <NavLink to="/orders">Orders</NavLink>}
          {user && (user.role === 'ADMIN' || user.role === 'DEMO_VIEWER') && <NavLink to="/admin">Admin</NavLink>}
          {user ? (
            <button type="button" className="link link--nav" onClick={() => void signOut()}>
              Sign out ({user.name})
            </button>
          ) : (
            <NavLink to="/login">Sign in</NavLink>
          )}
          <ThemeToggle />
        </nav>
      </header>
      <main id="main">
        <Outlet />
      </main>
      <CompareTray />
      <footer className="footer">
        <div>
          <p className="footer__brand">NOMA</p>
          <p className="footer__tagline">Thoughtful objects. Timeless spaces.</p>
        </div>
        <div className="footer__meta">
          <span>© NOMA — a portfolio project by heba.dev</span>
          <span>Simulated checkout · synthetic data only</span>
        </div>
      </footer>
    </MotionConfig>
  );
}
