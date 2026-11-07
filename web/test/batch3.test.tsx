import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import type { Order } from '../src/api/client';
import { setSession } from '../src/auth/session';

const PID = 'a'.repeat(24);
const OID = 'd'.repeat(24);
const TOKEN = 'c'.repeat(32);
const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data, timestamp: 't' }), { status });
const fail = (s: number, message = 'no') =>
  new Response(JSON.stringify({ success: false, error: { statusCode: s, error: 'x', message }, timestamp: 't' }), { status: s });
const cartOf = (over = {}) => ({
  items: [{ productId: PID, name: 'Dune Vase', slug: 'dune-vase', image: null, quantity: 2, unitPriceCents: 4000, lineTotalCents: 8000, availableStock: 5, status: 'ok' }],
  itemCount: 2,
  subtotalCents: 8000,
  bundles: [],
  bundleSavingsCents: 0,
  coupon: null,
  discountCents: 0,
  totalCents: 8000,
  currency: 'USD',
  hasIssues: false,
  warnings: [],
  ...over,
});
const order = (over: Partial<Order> = {}): Order => ({
  id: OID,
  status: 'DELIVERED',
  paymentStatus: 'SIMULATED_PAID',
  items: [{ productId: PID, name: 'Dune Vase', unitPriceCents: 4000, quantity: 2, lineTotalCents: 8000 }],
  subtotalCents: 8000,
  bundleSavingsCents: 0,
  coupon: null,
  discountCents: 0,
  totalCents: 8000,
  currency: 'USD',
  address: '12 Linden Street, Oslo',
  phone: '+47 912 34 567',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  paidAt: '2026-01-01T10:00:00Z',
  refundedAt: null,
  cancelledAt: null,
  createdAt: '2026-01-01T09:00:00Z',
  isDemo: false,
  timeline: [
    { type: 'PLACED', at: '2026-01-01T09:00:00Z', note: null },
    { type: 'PAID', at: '2026-01-01T10:00:00Z', note: 'Simulated payment' },
    { type: 'SHIPPED', at: '2026-01-02T10:00:00Z', note: null },
    { type: 'DELIVERED', at: '2026-01-03T10:00:00Z', note: null },
  ],
  returnRequest: null,
  returnable: true,
  cancellable: false,
  isGuest: false,
  guestEmail: null,
  payment: { mode: 'SIMULATED', notice: 'Simulated payment: no payment was taken and no card was charged.' },
  ...over,
});

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
      const call = { method: init?.method ?? 'GET', path: url.pathname + url.search + url.hash, body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      const custom = handler(call);
      if (custom) return Promise.resolve(custom);
      if (url.pathname === '/api/cart') return Promise.resolve(ok(cartOf({ items: [], itemCount: 0, subtotalCents: 0, totalCents: 0 })));
      if (url.pathname === '/api/cart/quote') return Promise.resolve(ok(cartOf()));
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
  setSession({ accessToken: 'a', refreshToken: 'r'.repeat(24), user: { id: 'u'.repeat(24), email: 'ada@example.com', name: 'Ada', role, isDemo: false } } as never);

beforeEach(() => {
  setSession(null);
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setSession(null);
  localStorage.clear();
});

describe('guest checkout and tracking', () => {
  it('places a guest order from the browser cart and keeps the tracking code out of every URL sent', async () => {
    localStorage.setItem('noma-cart', JSON.stringify([{ productId: PID, quantity: 2 }]));
    const calls = mockApi((c) => {
      if (c.path === '/api/order/guest') return ok({ order: order({ status: 'PENDING_PAYMENT', isGuest: true, guestEmail: 'g@example.com' }), trackingToken: TOKEN, trackPath: `/track/${OID}#${TOKEN}` }, 201);
      if (c.path === '/api/order/track') return ok(order({ status: 'PENDING_PAYMENT', isGuest: true, guestEmail: 'g@example.com', cancellable: true, returnable: false }));
      return undefined;
    });
    renderAt('/checkout');
    await userEvent.type(await screen.findByLabelText(/Email for the confirmation/), 'g@example.com');
    await userEvent.type(screen.getByLabelText('Delivery address'), '12 Linden Street, Oslo');
    await userEvent.type(screen.getByLabelText('Phone number'), '+47 912 34 567');
    await userEvent.click(screen.getByRole('button', { name: /place order/i }));
    expect(await screen.findByText(/Keep this page’s link/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/order/guest')!.body).toEqual({
      email: 'g@example.com',
      items: [{ productId: PID, quantity: 2 }],
      address: '12 Linden Street, Oslo',
      phone: '+47 912 34 567',
    });
    expect(calls.find((c) => c.path === '/api/order/track')!.body).toEqual({ orderId: OID, token: TOKEN });
    expect(calls.every((c) => !c.path.includes(TOKEN))).toBe(true);
    expect(localStorage.getItem('noma-cart')).toBeNull();
    // A guest cannot request a return or reorder from tracking.
    expect(screen.queryByRole('button', { name: 'Buy again' })).not.toBeInTheDocument();
  });

  it('checks the order number and code before looking anything up', async () => {
    const calls = mockApi();
    renderAt('/track');
    await userEvent.type(screen.getByLabelText('Order number'), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Track order' }));
    expect(screen.getByRole('alert')).toHaveTextContent('exactly as they appear');
    expect(calls.some((c) => c.path.startsWith('/api/order'))).toBe(false);
  });

  it('says so when the code does not match', async () => {
    mockApi((c) => (c.path === '/api/order/track' ? fail(404, 'Order not found') : undefined));
    renderAt(`/track/${OID}#${'0'.repeat(32)}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t find an order with that number');
  });

  it('merges the browser cart into the account at sign-in and reports what did not fit', async () => {
    localStorage.setItem('noma-cart', JSON.stringify([{ productId: PID, quantity: 2 }]));
    signIn();
    const calls = mockApi((c) =>
      c.path === '/api/cart/merge' ? ok({ cart: cartOf(), added: 1, skipped: [{ productId: PID, name: 'Dune Vase', reason: 'only 1 more could be added' }] }) : undefined,
    );
    renderAt('/cart');
    expect(await screen.findByText(/Not everything could be carried over/)).toHaveTextContent('Dune Vase (only 1 more could be added)');
    expect(calls.find((c) => c.path === '/api/cart/merge')!.body).toEqual({ items: [{ productId: PID, quantity: 2 }] });
    expect(localStorage.getItem('noma-cart')).toBeNull();
  });
});

describe('order page', () => {
  it('shows the tracking timeline and lets a customer request a return', async () => {
    signIn();
    const calls = mockApi((c) => {
      if (c.path === `/api/order/${OID}`) return ok(order());
      if (c.path === `/api/order/${OID}/return`)
        return ok(order({ returnable: false, returnRequest: { status: 'REQUESTED', reason: 'It arrived chipped.', requestedAt: 't', decidedAt: null, note: null } }));
      return undefined;
    });
    renderAt(`/orders/${OID}`);
    const timeline = await screen.findByRole('region', { name: 'Tracking' });
    expect(within(timeline).getAllByText('Delivered').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Request a return' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send return request' }));
    expect(screen.getByRole('alert')).toHaveTextContent('at least 10 characters');
    await userEvent.type(screen.getByLabelText(/Why are you returning/), 'It arrived chipped.');
    await userEvent.click(screen.getByRole('button', { name: 'Send return request' }));
    expect(await screen.findByText(/waiting for the shop/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === `/api/order/${OID}/return`)!.body).toEqual({ reason: 'It arrived chipped.' });
  });

  it('cancels before shipping after confirming, and re-adds a past order to the cart', async () => {
    signIn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const calls = mockApi((c) => {
      if (c.path === `/api/order/${OID}`) return ok(order({ status: 'PAID', cancellable: true, returnable: false, timeline: order().timeline!.slice(0, 2) }));
      if (c.path === `/api/order/${OID}/cancel`) return ok(order({ status: 'CANCELLED', paymentStatus: 'SIMULATED_REFUNDED', cancellable: false, returnable: false }));
      if (c.path === `/api/order/${OID}/reorder`) return ok({ cart: cartOf(), added: 2, skipped: [] });
      return undefined;
    });
    renderAt(`/orders/${OID}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel order' }));
    expect(await screen.findByRole('heading', { name: 'Cancelled' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Buy again' }));
    expect(await screen.findByText(/2 items added to your cart at today’s prices/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([`/api/order/${OID}/cancel`, `/api/order/${OID}/reorder`]);
  });
});

describe('notifications', () => {
  it('shows the unread count in the header and marks a notification read when opened', async () => {
    signIn();
    const calls = mockApi((c) => {
      if (c.path === '/api/notifications')
        return ok({ items: [{ id: 'n'.repeat(24), type: 'order', title: 'Your order is on its way', body: 'Order …dddddd', link: `/orders/${OID}`, read: false, createdAt: '2026-01-02T10:00:00Z' }], unread: 1 });
      if (c.path.endsWith('/read')) return ok({ unread: 0 });
      if (c.path === `/api/order/${OID}`) return ok(order());
      return undefined;
    });
    renderAt('/notifications');
    expect(await screen.findByRole('link', { name: 'Notifications, 1 unread' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /Your order is on its way/ }));
    await waitFor(() => expect(calls.some((c) => c.path === `/api/notifications/${'n'.repeat(24)}/read`)).toBe(true));
    expect(await screen.findByRole('region', { name: 'Tracking' })).toBeInTheDocument();
  });
});

describe('address book', () => {
  it('adds an address, checking required fields first', async () => {
    signIn();
    const saved: unknown[] = [];
    const calls = mockApi((c) => {
      if (c.path === '/api/addresses' && c.method === 'GET') return ok(saved);
      if (c.path === '/api/addresses' && c.method === 'POST') {
        saved.push({ ...(c.body as object), id: 'e'.repeat(24), isDefault: true, createdAt: 't' });
        return ok(saved[0], 201);
      }
      return undefined;
    });
    renderAt('/account/addresses');
    await userEvent.click(await screen.findByRole('button', { name: 'Add an address' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save address' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Full name');
    for (const [label, value] of [
      ['Full name', 'Ada Lovelace'],
      ['Street and number', '12 Linden Street'],
      ['Postal code', '0150'],
      ['City', 'Oslo'],
      ['Country', 'Norway'],
      ['Phone number', '+47 912 34 567'],
    ])
      await userEvent.type(screen.getByLabelText(label!), value!);
    await userEvent.click(screen.getByRole('button', { name: 'Save address' }));
    expect(await screen.findByText(/Ada Lovelace, 12 Linden Street, 0150 Oslo, Norway/)).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ fullName: 'Ada Lovelace', city: 'Oslo' });
  });
});
