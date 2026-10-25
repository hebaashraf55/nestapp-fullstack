import { motion } from 'framer-motion';
import { ApiStatus } from '../components/ApiStatus';

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
          A storefront in progress
        </motion.p>
        <motion.h1 variants={rise} initial="hidden" animate="show" custom={1}>
          Objects worth <em>lingering</em> over.
        </motion.h1>
        <motion.p className="lede" variants={rise} initial="hidden" animate="show" custom={2}>
          Atelier Noor is a full-stack portfolio project: a NestJS API and this React storefront. The catalogue
          opens when the backend catalogue endpoints land — nothing on this page is placeholder stock.
        </motion.p>
        <motion.div variants={rise} initial="hidden" animate="show" custom={3}>
          <ApiStatus />
        </motion.div>
      </section>

      <section className="grid" aria-label="Project status">
        {[
          ['Live now', 'Health check, security headers, CORS allow-list, safe error envelope.'],
          ['Next', 'Accounts and roles, then the catalogue, cart and simulated checkout.'],
          ['Always', 'No payment gateway. No card fields. Demo data is synthetic.'],
        ].map(([title, body], i) => (
          <motion.article
            key={title}
            className="card"
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ delay: 0.08 * i, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <h2>{title}</h2>
            <p>{body}</p>
          </motion.article>
        ))}
      </section>
    </>
  );
}
