import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { addToCart, apiGet, type Cart, type Product } from '../src/api/client';
import { getSession, type Role, setSession } from '../src/auth/session';

const user = (role: Role = 'CUSTOMER') => ({
  id: 'u'.repeat(24),
  email: 'demo-customer@example.com',
  name: 'Demo Customer',
  role,
  isDemo: true,
});
const signIn = (role: Role = 'CUSTOMER') =>
  setSession({ accessToken: 'access-1', refreshToken: 'refresh-1-aaaaaaaaaaaa', user: user(role) });

const PID = 'a'.repeat(24);
const product = (over: Partial<Product> = {}): Product => ({
  id: PID,
  name: 'Dune Vase',
  slug: 'dune-vase',
  description: 'A vase.',
  images: ['/catalogue/dune-vase.svg'],
  priceCents: 10000,
  discountPercent: 20,
  salePriceCents: 8000,
  currency: 'USD',
  stock: 6,
  inStock: true,
  category: null,
  brand: null,
  isDemo: true,
  createdAt: 't',
  ...over,
});
const cartOf = (over: Partial<Cart> = {}): Cart => ({
  items: [
    {
      productId: PID,
      name: 'Dune Vase',
      slug: 'dune-vase',
      image: '/catalogue/dune-vase.svg',
      quantity: 2,
      unitPriceCents: 8000,
      lineTotalCents: 16000,
      availableStock: 6,
      status: 'ok',
    },
  ],
  itemCount: 2,
  subtotalCents: 16000,
  coupon: null,
  discountCents: 0,
  totalCents: 16000,
  currency: 'USD',
  hasIssues: false,
  warnings: [],
  ...over,
});
const emptyCart = cartOf({ items: [], itemCount: 0, subtotalCents: 0, totalCents: 0 });

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: true, data, timestamp: 't' }), { status });
const fail = (statusCode: number, message: string) =>
  new Response(JSON.stringify({ success: false, error: { statusCode, error: 'x', message }, timestamp: 't' }), {
    status: statusCode,
  });

interface Call {
  method: string;
  path: string;
  body: unknown;
  auth: string | null;
}
type Handler = (call: Call) => Response | undefined;

/** Records every request and answers from `handler`, falling back to benign defaults. */
function mockApi(handler: Handler = () => undefined) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const headers = new Headers(init?.headers);
      const call: Call = {
        method: init?.method ?? 'GET',
        path: url.pathname + url.search,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        auth: headers.get('Authorization'),
      };
      calls.push(call);
      const custom = handler(call);
      if (custom) return Promise.resolve(custom);
      if (url.pathname === '/api/health') return Promise.resolve(ok({ status: 'ok', paymentsMode: 'simulated' }));
      if (url.pathname === '/api/cart') return Promise.resolve(ok(emptyCart));
      if (url.pathname === '/api/product') return Promise.resolve(ok({ items: [], page: 1, limit: 4, total: 0, totalPages: 1 }));
      return Promise.resolve(fail(404, 'Not found'));
    }),
  );
  return calls;
}
const renderAt = (path: string, state?: unknown) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: path.split('?')[0] as string, search: path.includes('?') ? `?${path.split('?')[1]}` : '', state }]}>
      <App />
    </MemoryRouter>,
  );

beforeEach(() => setSession(null));
afterEach(() => {
  vi.unstubAllGlobals();
  setSession(null);
});

describe('API client authentication', () => {
  it('sends the bearer token only when signed in', async () => {
    const calls = mockApi(() => ok({ x: 1 }));
    await apiGet('/api/thing');
    signIn();
    await apiGet('/api/thing');
    expect(calls.map((c) => c.auth)).toEqual([null, 'Bearer access-1']);
  });

  it('refreshes once on 401 and replays the request with the new token', async () => {
    signIn();
    const calls = mockApi((c) => {
      if (c.path === '/api/auth/refresh') return ok({ Credentials: { accessToken: 'access-2', refreshToken: 'refresh-2-bbbbbbbbbbbb' } });
      if (c.path === '/api/cart') return c.auth === 'Bearer access-2' ? ok(cartOf()) : fail(401, 'Unauthorized');
      return undefined;
    });
    const result = await addToCart(PID, 1).catch((e: unknown) => e);
    // POST /api/cart replays too, but this handler answers 401 for POST only without the new token
    expect(result).toMatchObject({ itemCount: 2 });
    expect(calls.map((c) => `${c.method} ${c.path} ${c.auth}`)).toEqual([
      'POST /api/cart Bearer access-1',
      'POST /api/auth/refresh null',
      'POST /api/cart Bearer access-2',
    ]);
    expect(calls[1]!.body).toEqual({ refreshToken: 'refresh-1-aaaaaaaaaaaa' });
    expect(getSession()?.refreshToken).toBe('refresh-2-bbbbbbbbbbbb');
  });

  it('signs the user out when the refresh fails, and does not loop', async () => {
    signIn();
    const calls = mockApi((c) => (c.path === '/api/auth/refresh' ? fail(401, 'Invalid session') : fail(401, 'Unauthorized')));
    await expect(apiGet('/api/cart')).rejects.toMatchObject({ statusCode: 401 });
    expect(getSession()).toBeNull();
    expect(calls.filter((c) => c.path === '/api/auth/refresh')).toHaveLength(1);
  });

  it('never tries to refresh for the auth routes themselves', async () => {
    signIn();
    const calls = mockApi(() => fail(401, 'Invalid email or password'));
    await expect(apiGet('/api/auth/profile')).rejects.toMatchObject({ statusCode: 401 });
    expect(calls).toHaveLength(1);
  });

  it('addToCart sends only a product id and a quantity', async () => {
    signIn();
    const calls = mockApi((c) => (c.method === 'POST' ? ok(cartOf()) : undefined));
    await addToCart(PID, 3);
    expect(calls[0]!.body).toEqual({ productId: PID, quantity: 3 });
  });

  it('rejects a response that is not a cart', async () => {
    signIn();
    mockApi(() => ok({ nope: true }));
    await expect(addToCart(PID, 1)).rejects.toThrow('Unexpected response');
  });
});

describe('Login', () => {
  it('signs in, stores the session and goes to the cart', async () => {
    const calls = mockApi((c) =>
      c.path === '/api/auth/login' ? ok({ Credentials: { accessToken: 'a', refreshToken: 'r'.repeat(24) }, user: user() }) : undefined,
    );
    renderAt('/login');
    await userEvent.type(screen.getByLabelText('Email'), ' demo-customer@example.com ');
    await userEvent.type(screen.getByLabelText('Password'), 'secret-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Your cart' })).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/auth/login')!.body).toEqual({
      email: 'demo-customer@example.com',
      password: 'secret-password',
    });
    expect(getSession()?.user.role).toBe('CUSTOMER');
    expect(screen.getByRole('button', { name: /Sign out \(Demo Customer\)/ })).toBeInTheDocument();
  });

  it('shows the generic error and stays signed out on a bad password', async () => {
    mockApi((c) => (c.path === '/api/auth/login' ? fail(401, 'Invalid email or password') : undefined));
    renderAt('/login');
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(getSession()).toBeNull();
  });

  it('ignores an off-site return path after sign-in', async () => {
    mockApi((c) =>
      c.path === '/api/auth/login' ? ok({ Credentials: { accessToken: 'a', refreshToken: 'r'.repeat(24) }, user: user() }) : undefined,
    );
    renderAt('/login', { from: '//evil.example.com' });
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'pw-pw-pw-pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Your cart' })).toBeInTheDocument();
  });

  it('signing out clears the session and ends it on the server', async () => {
    signIn();
    const calls = mockApi((c) => (c.path === '/api/auth/logout' ? ok({ loggedOut: true }) : undefined));
    renderAt('/cart');
    await userEvent.click(await screen.findByRole('button', { name: /Sign out/ }));
    await waitFor(() => expect(getSession()).toBeNull());
    expect(calls.find((c) => c.path === '/api/auth/logout')!.body).toEqual({ refreshToken: 'refresh-1-aaaaaaaaaaaa' });
    expect(await screen.findByText(/to see your cart/)).toBeInTheDocument();
  });
});

describe('Add to cart', () => {
  const detail = (p: Product, extra?: Handler): Handler => (c) =>
    c.path === `/api/product/${p.id}` ? ok(p) : extra?.(c);

  it('adds the chosen quantity and tells the user, sending no price', async () => {
    signIn();
    const calls = mockApi(detail(product(), (c) => (c.method === 'POST' && c.path === '/api/cart' ? ok(cartOf({ itemCount: 3 })) : undefined)));
    renderAt(`/shop/${PID}`);
    await userEvent.selectOptions(await screen.findByLabelText('Quantity'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    expect(await screen.findByText(/Added\./)).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ productId: PID, quantity: 3 });
    expect(await screen.findByLabelText('3 items')).toBeInTheDocument();
  });

  it('offers at most the stock on hand (capped at 10)', async () => {
    signIn();
    mockApi(detail(product({ stock: 4 })));
    renderAt(`/shop/${PID}`);
    const select = await screen.findByLabelText('Quantity');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['1', '2', '3', '4']);
  });

  it('shows the server’s message when the add is refused', async () => {
    signIn();
    mockApi(detail(product(), (c) => (c.method === 'POST' && c.path === '/api/cart' ? fail(409, 'Only 3 available') : undefined)));
    renderAt(`/shop/${PID}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Add to cart' }));
    expect(await screen.findByText('Only 3 available')).toBeInTheDocument();
  });

  it('asks signed-out visitors to sign in instead of showing a buy button', async () => {
    mockApi(detail(product()));
    renderAt(`/shop/${PID}`);
    await screen.findByRole('heading', { level: 1, name: 'Dune Vase' });
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to cart' })).not.toBeInTheDocument();
  });

  it('is read-only for the demo viewer', async () => {
    signIn('DEMO_VIEWER');
    mockApi(detail(product()));
    renderAt(`/shop/${PID}`);
    expect(await screen.findByText(/demo viewer account is read-only/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to cart' })).not.toBeInTheDocument();
  });

  it('shows sold out instead of a buy button', async () => {
    signIn();
    mockApi(detail(product({ stock: 0, inStock: false })));
    renderAt(`/shop/${PID}`);
    expect(await screen.findByText('This piece is sold out.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to cart' })).not.toBeInTheDocument();
  });
});

describe('Cart page', () => {
  it('asks signed-out visitors to sign in and makes no cart request', async () => {
    const calls = mockApi();
    renderAt('/cart');
    expect(await screen.findByText(/to see your cart/)).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/api/cart')).toBe(false);
  });

  it('shows server-priced lines, totals and the simulated-checkout notice', async () => {
    signIn();
    mockApi((c) => (c.path === '/api/cart' ? ok(cartOf({ coupon: { code: 'SAVE10', discountPercent: 10 }, discountCents: 1600, totalCents: 14400 })) : undefined));
    renderAt('/cart');
    expect(await screen.findByRole('heading', { name: 'Dune Vase' })).toBeInTheDocument();
    expect(screen.getByText('$80.00 each')).toBeInTheDocument();
    const summary = screen.getByRole('complementary', { name: 'Order summary' });
    expect(within(summary).getByText('$160.00')).toBeInTheDocument();
    expect(within(summary).getByText('−$16.00')).toBeInTheDocument();
    expect(within(summary).getByText('$144.00')).toBeInTheDocument();
    expect(within(summary).getByText(/Checkout is simulated/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /checkout|pay/i })).not.toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    signIn();
    mockApi();
    renderAt('/cart');
    expect(await screen.findByText('Your cart is empty.')).toBeInTheDocument();
  });

  it('changes a quantity with the stepper (never by clearing a field) through the API and shows the returned totals', async () => {
    signIn();
    const calls = mockApi((c) => {
      if (c.path === '/api/cart' && c.method === 'GET') return ok(cartOf());
      if (c.method === 'PATCH') return ok(cartOf({ itemCount: 5, subtotalCents: 40000, totalCents: 40000 }));
      return undefined;
    });
    renderAt('/cart');
    await userEvent.click(await screen.findByRole('button', { name: 'Increase quantity of Dune Vase' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.filter((c) => c.method === 'PATCH').pop()!;
    expect(patch.path).toBe(`/api/cart/${PID}`);
    expect(patch.body).toEqual({ quantity: 3 });
    expect(await screen.findAllByText('$400.00')).not.toHaveLength(0);
  });

  it('cannot step below one: removing is a separate, explicit action', async () => {
    signIn();
    mockApi((c) => (c.path === '/api/cart' ? ok(cartOf({ items: [{ ...cartOf().items[0]!, quantity: 1 }] })) : undefined));
    renderAt('/cart');
    expect(await screen.findByRole('button', { name: 'Decrease quantity of Dune Vase' })).toBeDisabled();
  });

  it('removes a line', async () => {
    signIn();
    const calls = mockApi((c) => (c.method === 'DELETE' ? ok(emptyCart) : c.path === '/api/cart' ? ok(cartOf()) : undefined));
    renderAt('/cart');
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Dune Vase' }));
    expect(await screen.findByText('Your cart is empty.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE' && c.path === `/api/cart/${PID}`)).toBe(true);
  });

  it('applies a coupon code and shows the recalculated total', async () => {
    signIn();
    const calls = mockApi((c) => {
      if (c.path === '/api/cart/apply-coupon')
        return ok(cartOf({ coupon: { code: 'SAVE10', discountPercent: 10 }, discountCents: 1600, totalCents: 14400 }));
      return c.path === '/api/cart' ? ok(cartOf()) : undefined;
    });
    renderAt('/cart');
    await userEvent.type(await screen.findByLabelText('Coupon code'), 'save10');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText(/Coupon SAVE10 \(−10%\)/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/cart/apply-coupon')!.body).toEqual({ code: 'save10' });
  });

  it('shows the server’s reason when a coupon is refused', async () => {
    signIn();
    mockApi((c) => (c.path === '/api/cart/apply-coupon' ? fail(400, 'Invalid or expired coupon') : c.path === '/api/cart' ? ok(cartOf()) : undefined));
    renderAt('/cart');
    await userEvent.type(await screen.findByLabelText('Coupon code'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid or expired coupon');
  });

  it('flags lines with stock problems and shows server warnings', async () => {
    signIn();
    const bad = cartOf({
      items: [{ ...cartOf().items[0]!, status: 'insufficient-stock', availableStock: 1 }],
      hasIssues: true,
      warnings: ['Some items are unavailable or exceed the stock on hand.'],
    });
    mockApi((c) => (c.path === '/api/cart' ? ok(bad) : undefined));
    renderAt('/cart');
    expect(await screen.findByText('Not enough in stock for this quantity.')).toBeInTheDocument();
    expect(screen.getByText(/unavailable or exceed the stock/)).toBeInTheDocument();
  });

  it('shows an unavailable (deleted) product as removable only', async () => {
    signIn();
    const gone = cartOf({
      items: [{ productId: PID, name: null, slug: null, image: null, quantity: 1, unitPriceCents: 0, lineTotalCents: 0, availableStock: 0, status: 'unavailable' }],
      hasIssues: true,
    });
    mockApi((c) => (c.path === '/api/cart' ? ok(gone) : undefined));
    renderAt('/cart');
    expect(await screen.findByText('Unavailable item')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Increase quantity of unavailable item' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove unavailable item' })).toBeEnabled();
  });

  it('is read-only for the demo viewer', async () => {
    signIn('DEMO_VIEWER');
    mockApi((c) => (c.path === '/api/cart' ? ok(cartOf()) : undefined));
    renderAt('/cart');
    expect(await screen.findByText(/cart cannot be changed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Increase quantity of Dune Vase' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove Dune Vase' })).toBeDisabled();
    expect(screen.queryByLabelText('Coupon code')).not.toBeInTheDocument();
  });

  it('shows an error with retry when the cart cannot be loaded', async () => {
    signIn();
    let attempts = 0;
    mockApi((c) => {
      if (c.path !== '/api/cart') return undefined;
      attempts += 1;
      return attempts === 1 ? fail(503, 'Service Unavailable') : ok(cartOf());
    });
    renderAt('/cart');
    expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t load your cart');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Dune Vase' })).toBeInTheDocument();
  });

  it('never renders a card-number or payment field', async () => {
    signIn();
    mockApi((c) => (c.path === '/api/cart' ? ok(cartOf()) : undefined));
    const { container } = renderAt('/cart');
    await screen.findByRole('heading', { name: 'Dune Vase' });
    const names = [...container.querySelectorAll('input')].map((i) => `${i.name}${i.autocomplete}${i.getAttribute('aria-label') ?? ''}`.toLowerCase());
    expect(names.join(' ')).not.toMatch(/card|cvv|cvc|expiry|iban/);
  });
});
