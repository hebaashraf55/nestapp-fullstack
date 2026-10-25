import { MotionConfig } from 'framer-motion';
import { Link, NavLink, Outlet } from 'react-router-dom';

export function Layout() {
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
          <NavLink to="/about">About this build</NavLink>
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
