import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ApiStatus } from '../components/ApiStatus';
import { Featured } from '../components/Featured';

const rise = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.12 * i, duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export function Home() {
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
          NOMA gathers ceramics, glassware, textiles and lighting made to be lived with. A portfolio storefront:
          every piece is read live from the API and is synthetic demo data.
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

      <Featured />

      <section className="grid" aria-label="Project status">
        {[
          ['Shop', 'A live catalogue with search, filters and pagination, read straight from the API.'],
          ['Checkout', 'Server-priced cart, coupons, orders and a simulated payment flow.'],
          ['Always', 'No payment gateway. No card fields. Demo data is synthetic.'],
        ].map(([title, body], i) => (
          <motion.article
            key={title}
            className="card"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ delay: 0.08 * i, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="card__num" aria-hidden="true">
              0{i + 1}
            </span>
            <h2>{title}</h2>
            <p>{body}</p>
          </motion.article>
        ))}
      </section>
    </>
  );
}
