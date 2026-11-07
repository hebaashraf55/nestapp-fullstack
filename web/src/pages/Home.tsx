import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getHome, getLooks, type HomeFeed } from '../api/client';
import { LookCard } from '../collections/LookCard';
import { ApiStatus } from '../components/ApiStatus';
import { ProductSkeletons } from '../components/ProductCard';
import { ProductRow } from '../components/ProductRow';
import { useRemote } from '../hooks/useRemote';
import { useShopper } from '../shopper/ShopperContext';
import { useProductsById } from '../shopper/useProducts';

const rise = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.12 * i, duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

const sectionId = (slug: string) => `category-${slug}`;

/** Highlights the category whose section is currently on screen. */
function useActiveSection(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join('|');
  useEffect(() => {
    if (!key || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-20% 0px -60% 0px' },
    );
    for (const id of key.split('|')) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [key]);
  return active;
}

function CategoryNav({ feed, active }: { feed: HomeFeed; active: string | null }) {
  const list = useRef<HTMLUListElement>(null);
  // On phones the categories are a horizontal strip: keep the current one in view.
  useEffect(() => {
    const ul = list.current;
    const chip = ul?.querySelector<HTMLElement>('[aria-current="true"]');
    if (ul && chip && ul.scrollWidth > ul.clientWidth) ul.scrollTo({ left: chip.offsetLeft - ul.offsetLeft - 16, behavior: 'smooth' });
  }, [active]);
  return (
    <nav className="catnav" aria-label="Shop by category">
      <p className="catnav__title">Categories</p>
      <ul ref={list}>
        {feed.categories.map((c) => {
          const id = sectionId(c.slug);
          return (
            <li key={c.id}>
              <a href={`#${id}`} aria-current={active === id ? 'true' : undefined}>
                <span>{c.name}</span>
                <span className="catnav__count" aria-label={`${c.count} products`}>
                  {c.count}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      <Link to="/shop" className="catnav__all">
        Browse everything
      </Link>
    </nav>
  );
}

function RecentlyViewed() {
  const { recent } = useShopper();
  const { items } = useProductsById(recent.slice(0, 4));
  return <ProductRow id="recently-viewed" title="Recently viewed" products={items} />;
}

function ShopTheLook() {
  const looks = useRemote((s) => getLooks({}, s), 'home-looks');
  if (looks.phase !== 'ready' || looks.data.length === 0) return null;
  return (
    <section className="row" id="shop-the-look" aria-labelledby="shop-the-look-title">
      <div className="section-head">
        <h2 id="shop-the-look-title">Shop the Look</h2>
        <Link to="/looks">All looks</Link>
      </div>
      <div className="looks">
        {looks.data.slice(0, 3).map((l) => (
          <LookCard key={l.id} look={l} />
        ))}
      </div>
    </section>
  );
}

function Feed({ feed }: { feed: HomeFeed }) {
  const sections = feed.categories.filter((c) => c.products.length > 0);
  const active = useActiveSection(sections.map((c) => sectionId(c.slug)));
  if (feed.categories.every((c) => c.count === 0)) {
    return <p className="notice">No products yet. Run the catalogue seed or add some as an admin.</p>;
  }
  return (
    <div className="home">
      <CategoryNav feed={feed} active={active} />
      <div className="home__main">
        <ProductRow id="featured" title="Featured" products={feed.featured.slice(0, 4)} more={{ to: '/shop?featured=true', label: 'View all' }} />
        <ProductRow id="new-arrivals" title="New arrivals" products={feed.newArrivals.slice(0, 4)} more={{ to: '/shop?sort=newest', label: 'View all' }} />
        <ProductRow
          id="best-sellers"
          title="Best sellers"
          products={feed.bestSellers.slice(0, 4)}
          note="Ranked by units in paid orders."
        />
        <ShopTheLook />
        <ProductRow id="on-sale" title="On sale" products={feed.onSale.slice(0, 4)} more={{ to: '/shop?onSale=true', label: 'All offers' }} />
        {sections.map((c) => (
          <ProductRow
            key={c.id}
            id={sectionId(c.slug)}
            title={c.name}
            products={c.products}
            more={{ to: `/shop?category=${c.id}`, label: `View all ${c.count}` }}
          />
        ))}
        <RecentlyViewed />
      </div>
    </div>
  );
}

export function Home() {
  const feed = useRemote((s) => getHome(s), 'home');
  return (
    <>
      <section className="hero">
        <div className="hero__glow" aria-hidden="true" />
        <motion.p className="eyebrow" variants={rise} initial="hidden" animate="show" custom={0}>
          Home decor & lifestyle
        </motion.p>
        <motion.h1 variants={rise} initial="hidden" animate="show" custom={1}>
          Thoughtful objects. <em>Timeless spaces.</em>
        </motion.h1>
        <motion.p className="lede" variants={rise} initial="hidden" animate="show" custom={2}>
          Ceramics, glassware, textiles, lighting, furniture and kitchen pieces made to be lived with. A portfolio
          storefront: every piece is read live from the API, and all products are invented demo data.
        </motion.p>
        <motion.div className="hero__actions" variants={rise} initial="hidden" animate="show" custom={3}>
          <Link to="/shop" className="btn">
            Shop the collection
          </Link>
          <Link to="/about" className="btn btn--ghost">
            About NOMA
          </Link>
        </motion.div>
        <motion.div variants={rise} initial="hidden" animate="show" custom={4}>
          <ApiStatus />
        </motion.div>
        <motion.figure
          className="hero__media"
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 1, ease: [0.22, 1, 0.36, 1] }}
        >
          <img src="/catalogue/dune-stoneware-vase.jpg" alt="" width="400" height="500" />
        </motion.figure>
      </section>

      <div className="home-wrap">
        {feed.phase === 'loading' && <ProductSkeletons count={8} />}
        {feed.phase === 'error' && (
          <p className="notice notice--bad" role="alert">
            The catalogue is unavailable right now ({feed.error.message}).
          </p>
        )}
        {feed.phase === 'ready' && <Feed feed={feed.data} />}
      </div>
    </>
  );
}
