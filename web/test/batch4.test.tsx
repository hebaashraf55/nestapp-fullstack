import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import type { Analytics, Order } from '../src/api/client';
import { setSession } from '../src/auth/session';

const PID = 'a'.repeat(24);
const OID = 'd'.repeat(24);
const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data, timestamp: 't' }), { status });
const fail = (s: number, message = 'no') =>
  new Response(JSON.stringify({ success: false, error: { statusCode: s, error: 'x', message }, timestamp: 't' }), { status: s });
const cart = (over = {}) => ({
  items: [{ productId: PID, name: 'Dune Vase', slug: 'dune-vase', image: null, quantity: 1, unitPriceCents: 4000, lineTotalCents: 4000, availableStock: 5, status: 'ok' }],
  itemCount: 1,
  subtotalCents: 4000,
  bundles: [],
  bundleSavingsCents: 0,
  coupon: null,
  rejectedCoupon: null,
  discountCents: 0,
  totalCents: 4000,
  currency: 'USD',
  hasIssues: false,
  warnings: [],
  ...over,
});
const order = (over: Partial<Order> = {}): Order => ({
  id: OID,
  status: 'SHIPPED',
  paymentStatus: 'SIMULATED_PAID',
  items: [{ productId: PID, name: 'Dune Vase', unitPriceCents: 4000, quantity: 1, lineTotalCents: 4000 }],
  subtotalCents: 4000,
  bundleSavingsCents: 0,
  coupon: null,
  discountCents: 0,
  totalCents: 4000,
  currency: 'USD',
  address: 'Ada Lovelace, 12 Linden Street, 0150 Oslo, Norway',
  phone: '+47 912 34 567',
  expiresAt: 't',
  paidAt: '2026-01-01T10:00:00Z',
  refundedAt: null,
  cancelledAt: null,
  createdAt: '2026-01-01T09:00:00Z',
  isDemo: false,
  timeline: [],
  returnRequest: null,
  shipment: { carrier: 'DEMO_EXPRESS', trackingNumber: 'SIM-1A2B3C4D5E', shippedAt: '2026-01-02T10:00:00Z', simulated: true },
  returnable: false,
  cancellable: false,
  payment: { mode: 'SIMULATED', notice: 'Simulated payment: no payment was taken and no card was charged.' },
  ...over,
});
const report: Analytics = {
  days: 7,
  from: '2026-01-01',
  to: '2026-01-07',
  currency: 'USD',
  truncated: false,
  scope: 'all',
  notice: 'Simulated payment: no payment was taken and no card was charged.',
  totals: { ordersPlaced: 4, ordersPaid: 3, paidCents: 21200, refundedCents: 4000, netCents: 17200, averageOrderCents: 7067, paymentRate: 0.75, bundleSavingsCents: 0, discountCents: 800 },
  daily: Array.from({ length: 7 }, (_, i) => ({ date: `2026-01-0${i + 1}`, ordersPlaced: i === 6 ? 4 : 0, ordersPaid: i === 6 ? 3 : 0, paidCents: i === 6 ? 21200 : 0, refundedCents: 0 })),
  topProducts: [{ productId: PID, name: 'Dune Vase', units: 2, revenueCents: 8000 }],
  statusOfPlaced: { PAID: 2, PENDING_PAYMENT: 1, CANCELLED: 1 },
  customers: { buyers: 2, returning: 1, guestOrders: 0 },
  coupons: [{ code: 'TEN', orders: 1, discountCents: 800 }],
  returns: { requested: 0, received: 0, rate: null },
};

interface Call {
  method: string;
  path: string;
  body: unknown;
}
function mockApi(handler: (c: Call) => Response | undefined = () => undefined) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const call = { method: init?.method ?? 'GET', path: url.pathname + url.search, body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      const custom = handler(call);
      if (custom) return Promise.resolve(custom);
      if (url.pathname === '/api/cart') return Promise.resolve(ok(cart()));
      if (url.pathname === '/api/wishlist' || url.pathname === '/api/recently-viewed') return Promise.resolve(ok({ productIds: [], items: [] }));
      if (url.pathname === '/api/notifications') return Promise.resolve(ok({ items: [], unread: 0 }));
      return Promise.resolve(fail(404));
    }),
  );
  return calls;
}
const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
const signIn = (role = 'CUSTOMER') =>
  setSession({ accessToken: 'a', refreshToken: 'r'.repeat(24), user: { id: 'u'.repeat(24), email: 'ada@example.com', name: 'Ada', role, isDemo: role === 'DEMO_VIEWER' } } as never);

beforeEach(() => {
  setSession(null);
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setSession(null);
});

describe('promotions in the cart', () => {
  it('shows a fixed-amount coupon and lets the customer remove it', async () => {
    signIn();
    const calls = mockApi((c) => {
      if (c.path === '/api/cart' && c.method === 'GET')
        return ok(cart({ coupon: { id: 'c1', code: 'TENOFF', type: 'FIXED', discountPercent: 0, amountOffCents: 1000, automatic: false }, discountCents: 1000, totalCents: 3000 }));
      if (c.path === '/api/cart/coupon' && c.method === 'DELETE') return ok(cart());
      return undefined;
    });
    renderAt('/cart');
    const summary = await screen.findByRole('complementary', { name: 'Order summary' });
    expect(within(summary).getByText(/Coupon TENOFF \(−\$10\.00\)/)).toBeInTheDocument();
    await userEvent.click(within(summary).getByRole('button', { name: 'Remove coupon TENOFF' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/cart/coupon')).toBe(true));
    expect(await within(summary).findByText('$40.00', { selector: '.summary__total dd' })).toBeInTheDocument();
  });

  it('labels an automatic offer and blocks checkout while a chosen code cannot be used', async () => {
    signIn();
    mockApi((c) =>
      c.path === '/api/cart'
        ? ok(cart({ rejectedCoupon: { code: 'LAST', reason: 'has been fully used' }, warnings: ['Coupon LAST has been fully used, so it was not applied.'] }))
        : undefined,
    );
    renderAt('/checkout');
    expect(await screen.findByRole('alert')).toHaveTextContent('Coupon LAST has been fully used');
    expect(screen.getByRole('button', { name: /place order/i })).toBeDisabled();
  });
});

describe('fulfilment', () => {
  it('shows the customer the simulated carrier and tracking number', async () => {
    signIn();
    mockApi((c) => (c.path === `/api/order/${OID}` ? ok(order()) : undefined));
    renderAt(`/orders/${OID}`);
    expect(await screen.findByText('SIM-1A2B3C4D5E')).toBeInTheDocument();
    expect(screen.getByText(/The carrier is simulated/)).toBeInTheDocument();
  });

  it('lets an admin choose a carrier and tracking number when shipping', async () => {
    signIn('ADMIN');
    const admOrder = { ...order({ status: 'PAID', shipment: null }), customer: { displayName: 'Ada L.', maskedEmail: 'a***@example.com' } };
    const calls = mockApi((c) => {
      if (c.path.startsWith('/api/admin/orders')) return ok({ items: [admOrder], page: 1, limit: 20, total: 1, totalPages: 1 });
      if (c.method === 'PATCH') return ok(order());
      return undefined;
    });
    renderAt('/admin/orders');
    await userEvent.selectOptions(await screen.findByLabelText('Carrier'), 'DEMO_EXPRESS');
    await userEvent.type(screen.getByLabelText('Tracking number (optional)'), 'DX-1234567');
    await userEvent.click(screen.getByRole('button', { name: 'Mark shipped' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ path: `/api/order/${OID}/status`, body: { status: 'SHIPPED', carrier: 'DEMO_EXPRESS', trackingNumber: 'DX-1234567' } }),
    );
  });

  it('prints a label that says it is simulated', async () => {
    signIn('ADMIN');
    mockApi((c) => (c.path === `/api/order/${OID}` ? ok(order()) : undefined));
    renderAt(`/admin/orders/${OID}/label`);
    const label = await screen.findByRole('article', { name: 'Shipping label' });
    expect(label).toHaveTextContent('SIMULATED LABEL · NOT VALID FOR POSTAGE');
    expect(label).toHaveTextContent('Demo Express');
    expect(label).toHaveTextContent('SIM-1A2B3C4D5E');
  });
});

describe('analytics and inventory', () => {
  it('shows real totals, a chart per measure with a table, and switches the period', async () => {
    signIn('ADMIN');
    const calls = mockApi((c) => (c.path.startsWith('/api/admin/analytics') ? ok({ ...report, days: Number(new URLSearchParams(c.path.split('?')[1]).get('days')) }) : undefined));
    renderAt('/admin/analytics');
    expect((await screen.findAllByText('$212.00', { selector: '.tile__value' })).length).toBe(1);
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Paid per day/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Orders placed per day/ })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Top products by units sold' })).toHaveTextContent('Dune Vase');
    await userEvent.click(screen.getByRole('button', { name: 'Last 90 days' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/admin/analytics?days=90')).toBe(true));
  });

  it('lists stock history with reasons and sends the reason with a stock change', async () => {
    signIn('ADMIN');
    mockApi((c) =>
      c.path.startsWith('/api/admin/inventory/movements')
        ? ok({ items: [{ id: 'm1', productId: PID, productName: 'Dune Vase', change: -2, reason: 'ORDER_RESERVED', note: null, orderId: OID, actorId: null, createdAt: '2026-01-02T10:00:00Z' }], page: 1, limit: 25, total: 1, totalPages: 1 })
        : undefined,
    );
    renderAt('/admin/inventory');
    const table = await screen.findByRole('table', { name: 'Stock history' });
    expect(table).toHaveTextContent('Reserved by an order');
    expect(table).toHaveTextContent('-2');
    expect(table).toHaveTextContent('Order …dddddd');
  });
});
