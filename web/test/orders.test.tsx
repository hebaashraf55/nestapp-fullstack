import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import type { Cart, Order } from '../src/api/client';
import { type Role, setSession } from '../src/auth/session';

const OID = 'f'.repeat(24);
const PID = 'a'.repeat(24);
const signIn = (role: Role = 'CUSTOMER') =>
  setSession({
    accessToken: 'access-1',
    refreshToken: 'refresh-1-aaaaaaaaaaaa',
    user: { id: 'u'.repeat(24), email: 'c@example.com', name: 'Demo Customer', role, isDemo: true },
  });

const NOTICE = 'Simulated payment: no payment was taken and no card was charged.';
const order = (over: Partial<Order> = {}): Order => ({
  id: OID,
  userId: 'u'.repeat(24),
  items: [{ productId: PID, name: 'Dune Vase', quantity: 2, unitPriceCents: 8000, lineTotalCents: 16000 }],
  subtotalCents: 16000,
  coupon: null,
  discountCents: 0,
  totalCents: 16000,
  currency: 'USD',
  address: '12 Nile Street, Cairo',
  phone: '+201000000000',
  status: 'PENDING_PAYMENT',
  paymentStatus: 'SIMULATED_UNPAID',
  expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  createdAt: new Date().toISOString(),
  payment: { mode: 'SIMULATED', notice: NOTICE },
  ...over,
}) as Order;
const cart = (n: number, hasIssues = false): Cart => ({
  items: n
    ? [{ productId: PID, name: 'Dune Vase', slug: 'dune-vase', image: '/catalogue/dune-vase.svg', quantity: n, unitPriceCents: 8000, lineTotalCents: 8000 * n, availableStock: 6, status: hasIssues ? 'out-of-stock' : 'ok' }]
    : [],
  itemCount: n,
  subtotalCents: 8000 * n,
  coupon: null,
  discountCents: 0,
  totalCents: 8000 * n,
  currency: 'USD',
  hasIssues,
  warnings: [],
});

const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data, timestamp: 't' }), { status });
const fail = (statusCode: number, message: string) =>
  new Response(JSON.stringify({ success: false, error: { statusCode, error: 'x', message }, timestamp: 't' }), { status: statusCode });

interface Call { method: string; path: string; body: unknown }
function mockApi(handler: (c: Call) => Response | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const call: Call = { method: init?.method ?? 'GET', path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      const custom = handler(call);
      if (custom) return Promise.resolve(custom);
      if (url.pathname === '/api/health') return Promise.resolve(ok({ status: 'ok', paymentsMode: 'simulated' }));
      if (url.pathname === '/api/cart') return Promise.resolve(ok(cart(0)));
      return Promise.resolve(fail(404, 'Not found'));
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

beforeEach(() => setSession(null));
afterEach(() => {
  vi.unstubAllGlobals();
  setSession(null);
});

describe('checkout', () => {
  it('asks signed-out visitors to sign in and calls nothing that places an order', async () => {
    const calls = mockApi(() => undefined);
    renderAt('/checkout');
    expect(await screen.findByRole('link', { name: 'Sign in', description: '' }).catch(() => screen.getAllByRole('link', { name: 'Sign in' })[0])).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('blocks the demo viewer', async () => {
    signIn('DEMO_VIEWER');
    mockApi((c) => (c.path === '/api/cart' ? ok(cart(2)) : undefined));
    renderAt('/checkout');
    expect(await screen.findByText(/demo viewer account is read-only/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /place order/i })).not.toBeInTheDocument();
  });

  it('shows an empty-cart message instead of a form', async () => {
    signIn();
    mockApi(() => undefined);
    renderAt('/checkout');
    expect(await screen.findByText(/your cart is empty/i)).toBeInTheDocument();
  });

  it('has no card or payment inputs, only address and phone', async () => {
    signIn();
    mockApi((c) => (c.path === '/api/cart' ? ok(cart(2)) : undefined));
    renderAt('/checkout');
    await screen.findByRole('button', { name: /place order \(simulated\)/i });
    const labels = screen.getAllByRole('textbox').concat(screen.getAllByRole('textbox')).map((e) => e.getAttribute('autocomplete'));
    expect(new Set(labels)).toEqual(new Set(['street-address', 'tel']));
    expect(document.querySelector('input[autocomplete^="cc-"]')).toBeNull();
    expect(screen.queryByLabelText(/card|cvv|expiry/i)).not.toBeInTheDocument();
  });

  it('submits only address and phone, then shows the new order', async () => {
    signIn();
    const calls = mockApi((c) => {
      if (c.path === '/api/cart') return ok(cart(2));
      if (c.method === 'POST' && c.path === '/api/order') return ok(order(), 201);
      if (c.path === `/api/order/${OID}`) return ok(order());
      return undefined;
    });
    const user = userEvent.setup();
    renderAt('/checkout');
    await user.type(await screen.findByLabelText('Delivery address'), '  12 Nile Street, Cairo ');
    await user.type(screen.getByLabelText('Phone number'), '+201000000000');
    await user.click(screen.getByRole('button', { name: /place order \(simulated\)/i }));
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/order');
    expect(post?.body).toEqual({ address: '12 Nile Street, Cairo', phone: '+201000000000' });
  });

  it('shows the server error and keeps the form when placing fails', async () => {
    signIn();
    mockApi((c) => {
      if (c.path === '/api/cart') return ok(cart(2));
      if (c.method === 'POST' && c.path === '/api/order') return fail(409, 'Not enough stock for Dune Vase');
      return undefined;
    });
    const user = userEvent.setup();
    renderAt('/checkout');
    await user.type(await screen.findByLabelText('Delivery address'), '12 Nile Street');
    await user.type(screen.getByLabelText('Phone number'), '+201000000000');
    await user.click(screen.getByRole('button', { name: /place order/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not enough stock for Dune Vase');
    expect(screen.getByRole('button', { name: /place order/i })).toBeEnabled();
  });

  it('disables ordering while the cart has issues', async () => {
    signIn();
    mockApi((c) => (c.path === '/api/cart' ? ok(cart(1, true)) : undefined));
    renderAt('/checkout');
    expect(await screen.findByRole('button', { name: /place order/i })).toBeDisabled();
  });
});

describe('cart page checkout link', () => {
  it('links customers to checkout and hides it from the demo viewer', async () => {
    signIn();
    mockApi((c) => (c.path === '/api/cart' ? ok(cart(2)) : undefined));
    const first = renderAt('/cart');
    expect(await screen.findByRole('link', { name: /continue to simulated checkout/i })).toHaveAttribute('href', '/checkout');
    first.unmount();
    signIn('DEMO_VIEWER');
    renderAt('/cart');
    await screen.findByText('Dune Vase');
    expect(screen.queryByRole('link', { name: /continue to simulated checkout/i })).not.toBeInTheDocument();
  });
});

describe('order history', () => {
  it('lists orders with status and total', async () => {
    signIn();
    mockApi((c) => (c.path === '/api/order' ? ok([order(), order({ id: 'e'.repeat(24), status: 'CANCELLED', paymentStatus: 'SIMULATED_UNPAID' })]) : undefined));
    renderAt('/orders');
    const main = await screen.findByRole('main');
    expect(await within(main).findByText('Awaiting simulated payment')).toBeInTheDocument();
    expect(within(main).getByText('Cancelled')).toBeInTheDocument();
    expect(within(main).getAllByRole('link', { name: /^Order / })[0]).toHaveAttribute('href', `/orders/${OID}`);
  });

  it('shows an empty state and an error state', async () => {
    signIn();
    mockApi((c) => (c.path === '/api/order' ? ok([]) : undefined));
    const first = renderAt('/orders');
    expect(await screen.findByText(/no orders yet/i)).toBeInTheDocument();
    first.unmount();
    mockApi((c) => (c.path === '/api/order' ? fail(503, 'Service Unavailable') : undefined));
    renderAt('/orders');
    expect(await screen.findByText(/couldn’t load your orders/i)).toBeInTheDocument();
  });

  it('asks signed-out visitors to sign in without calling the API for orders', async () => {
    const calls = mockApi(() => undefined);
    renderAt('/orders');
    expect(await screen.findByText(/to see your orders/i)).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/api/order')).toBe(false);
  });
});

describe('order detail and simulated payment', () => {
  it('pays with one click, sending an empty body, and shows the paid state', async () => {
    signIn();
    const calls = mockApi((c) => {
      if (c.method === 'GET' && c.path === `/api/order/${OID}`) return ok(order());
      if (c.method === 'POST' && c.path === `/api/order/${OID}/simulate-payment`)
        return ok(order({ status: 'PAID', paymentStatus: 'SIMULATED_PAID' }));
      return undefined;
    });
    const user = userEvent.setup();
    renderAt(`/orders/${OID}`);
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /simulate payment \(no real charge\)/i }));
    expect(await screen.findByRole('heading', { name: 'Paid (simulated)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /simulate payment/i })).not.toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body).toEqual({});
  });

  it('counts down the hold and disables payment once it has run out', async () => {
    signIn();
    mockApi((c) => (c.path === `/api/order/${OID}` ? ok(order({ expiresAt: new Date(Date.now() - 1000).toISOString() })) : undefined));
    renderAt(`/orders/${OID}`);
    expect(await screen.findByText(/hold has run out/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /simulate payment/i })).toBeDisabled();
  });

  it('shows the real state when the server says the order expired', async () => {
    signIn();
    let expired = false;
    mockApi((c) => {
      if (c.method === 'POST') {
        expired = true;
        return fail(409, 'This order has expired');
      }
      if (c.path === `/api/order/${OID}`) return ok(expired ? order({ status: 'EXPIRED' }) : order());
      return undefined;
    });
    const user = userEvent.setup();
    renderAt(`/orders/${OID}`);
    await user.click(await screen.findByRole('button', { name: /simulate payment/i }));
    expect(await screen.findByRole('heading', { name: 'Expired' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /simulate payment/i })).not.toBeInTheDocument();
  });

  it('keeps the page and shows the error when payment fails with a server error', async () => {
    signIn();
    mockApi((c) => {
      if (c.method === 'POST') return fail(503, 'Service Unavailable');
      if (c.path === `/api/order/${OID}`) return ok(order());
      return undefined;
    });
    const user = userEvent.setup();
    renderAt(`/orders/${OID}`);
    await user.click(await screen.findByRole('button', { name: /simulate payment/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /simulate payment/i })).toBeEnabled();
  });

  it('shows not-found for another customer’s order (404) and a sign-in prompt when signed out', async () => {
    signIn();
    mockApi((c) => (c.path === `/api/order/${OID}` ? fail(404, 'Order not found') : undefined));
    const first = renderAt(`/orders/${OID}`);
    expect(await screen.findByText(/couldn’t find that order/i)).toBeInTheDocument();
    first.unmount();
    setSession(null);
    mockApi(() => undefined);
    renderAt(`/orders/${OID}`);
    expect(await screen.findByText(/to see this order/i)).toBeInTheDocument();
  });

  it('shows coupon discount, refunded state and no payment button for non-pending orders', async () => {
    signIn();
    mockApi((c) =>
      c.path === `/api/order/${OID}`
        ? ok(order({ status: 'CANCELLED', paymentStatus: 'SIMULATED_REFUNDED', coupon: { code: 'SAVE10', discountPercent: 10 }, discountCents: 1600, totalCents: 14400 }))
        : undefined,
    );
    renderAt(`/orders/${OID}`);
    expect(await screen.findByText(/Simulated payment: refunded/)).toBeInTheDocument();
    expect(screen.getByText(/Coupon SAVE10/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /simulate payment/i })).not.toBeInTheDocument();
  });
});
