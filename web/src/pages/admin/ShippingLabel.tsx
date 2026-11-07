import { Link, useParams } from 'react-router-dom';
import { CARRIER_LABEL, getOrder } from '../../api/client';
import { useRemote } from '../../hooks/useRemote';
import { formatDate } from '../../lib/orderText';
import { RemoteView } from './RemoteView';

/** A printable label for a shipped order. Clearly marked: no carrier is booked and nothing is paid for postage. */
export function ShippingLabel() {
  const { id = '' } = useParams();
  const order = useRemote((s) => getOrder(id, s), `label:${id}`);
  return (
    <RemoteView state={order}>
      {(o) =>
        !o.shipment ? (
          <p className="notice">This order has not been shipped yet. <Link to="/admin/orders">Back to orders</Link></p>
        ) : (
          <>
            <div className="label-actions no-print">
              <button type="button" className="btn" onClick={() => window.print()}>
                Print label
              </button>
              <Link to="/admin/orders">Back to orders</Link>
            </div>
            <article className="label" aria-label="Shipping label">
              <p className="label__sim">SIMULATED LABEL · NOT VALID FOR POSTAGE</p>
              <header className="label__head">
                <strong>{CARRIER_LABEL[o.shipment.carrier]}</strong>
                <span>{formatDate(o.shipment.shippedAt)}</span>
              </header>
              <section>
                <p className="label__k">From</p>
                <p>NOMA (portfolio demo)</p>
              </section>
              <section>
                <p className="label__k">To</p>
                <p className="label__to">{o.address}</p>
                <p>{o.phone}</p>
              </section>
              <section className="label__track">
                <p className="label__k">Tracking number</p>
                <p className="label__code">{o.shipment.trackingNumber}</p>
                <div className="label__bars" aria-hidden="true">
                  {o.shipment.trackingNumber.split('').map((ch, i) => (
                    <span key={i} style={{ width: `${2 + (ch.charCodeAt(0) % 4)}px` }} />
                  ))}
                </div>
              </section>
              <footer className="label__foot">
                Order {o.id.slice(-6).toUpperCase()} · {o.items.reduce((n, i) => n + i.quantity, 0)} items
              </footer>
            </article>
          </>
        )
      }
    </RemoteView>
  );
}
