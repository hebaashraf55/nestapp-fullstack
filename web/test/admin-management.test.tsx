import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import type { Coupon, Product } from '../src/api/client';
import { type Role, setSession } from '../src/auth/session';

const signIn = (role: Role) =>
  setSession({
    accessToken: 'access-1',
    refreshToken: 'refresh-1-aaaaaaaaaaaa',
    user: { id: 'u'.repeat(24), email: 's@example.com', name: 'Staff', role, isDemo: role === 'DEMO_VIEWER' },
  });

const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data, timestamp: 't' }), { status });
const fail = (statusCode: number, message: string, details?: unknown) =>
  new Response(JSON.stringify({ success: false, error: { statusCode, error: 'x', message, details }, timestamp: 't' }), { status: statusCode });

interface Call {
  method: string;
  path: string;
  search: string;
  body: unknown;
}
function mockApi(handler: (c: Call) => Response | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const call: Call = { method: init?.method ?? 'GET', path: url.pathname, search: url.search, body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      const custom = handler(call);
      if (custom) return Promise.resolve(custom);
      if (url.pathname === '/api/health') return Promise.resolve(ok({ status: 'ok', paymentsMode: 'simulated' }));
      if (url.pathname === '/api/cart')
        return Promise.resolve(ok({ items: [], itemCount: 0, subtotalCents: 0, coupon: null, discountCents: 0, totalCents: 0, currency: 'USD', hasIssues: false, warnings: [] }));
      if (url.pathname === '/api/category') return Promise.resolve(ok([{ id: 'c'.repeat(24), name: 'Ceramics', slug: 'ceramics', image: null, isDemo: true, createdAt: 't' }]));
      if (url.pathname === '/api/brand') return Promise.resolve(ok([{ id: 'b'.repeat(24), name: 'Wadi Works', slug: 'wadi-works', image: null, isDemo: true, createdAt: 't' }]));
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
const page = <T,>(items: T[], over: object = {}) => ({ items, page: 1, limit: 10, total: items.length, totalPages: 1, ...over });

const PID = 'p'.repeat(24);
const product = (over: Partial<Product> = {}): Product => ({
  id: PID,
  name: 'Dune Vase',
  slug: 'dune-vase',
  description: 'A vase.',
  images: ['/catalogue/dune-vase.jpg'],
  priceCents: 8000,
  discountPercent: 10,
  salePriceCents: 7200,
  currency: 'USD',
  stock: 12,
  inStock: true,
  category: { id: 'c'.repeat(24), name: 'Ceramics', slug: 'ceramics' },
  brand: { id: 'b'.repeat(24), name: 'Wadi Works', slug: 'wadi-works' },
  isDemo: true,
  createdAt: 't',
  ...over,
});
const CID = 'k'.repeat(24);
const coupon = (over: Partial<Coupon> = {}): Coupon => ({
  id: CID,
  code: 'SPRING15',
  discountType: 'PERCENT',
  discountPercent: 15,
  expiresAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
  expired: false,
  active: true,
  status: 'ACTIVE',
  ordersPlaced: 3,
  isDemo: false,
  createdAt: 't',
  ...over,
});
const productList = (items: Product[]) => (c: Call) => (c.method === 'GET' && c.path === '/api/product' ? ok(page(items)) : undefined);

beforeEach(() => setSession(null));
afterEach(() => {
  vi.unstubAllGlobals();
  setSession(null);
});

describe('admin products', () => {
  it('lists products with category, price, stock and a status, and filters through the API', async () => {
    signIn('ADMIN');
    const calls = mockApi(productList([product(), product({ id: 'q'.repeat(24), name: 'Ember Holder', stock: 3 }), product({ id: 'r'.repeat(24), name: 'Tide Glasses', stock: 0, inStock: false })]));
    renderAt('/admin/products');
    const table = await screen.findByRole('table', { name: 'Products' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent(/Dune Vase.*Wadi Works.*Ceramics.*\$72\.00.*\$80\.00.*12.*In stock/);
    expect(rows[1]).toHaveTextContent('Low stock');
    expect(rows[2]).toHaveTextContent('Sold out');

    await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'vase');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Stock' }), 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      const last = calls.filter((c) => c.path === '/api/product').at(-1)!;
      expect(new URLSearchParams(last.search).get('q')).toBe('vase');
      expect(new URLSearchParams(last.search).get('inStock')).toBe('false');
    });
  });

  it('gives the demo viewer the list but no way to change anything', async () => {
    signIn('DEMO_VIEWER');
    mockApi(productList([product()]));
    renderAt('/admin/products');
    await screen.findByRole('table', { name: 'Products' });
    expect(screen.queryByRole('link', { name: 'New product' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stock' })).not.toBeInTheDocument();
    // The product form refuses a non-admin outright.
  });

  it('adjusts stock with a relative change and blocks one that would go below zero', async () => {
    signIn('ADMIN');
    const calls = mockApi((c) =>
      c.method === 'PATCH' && c.path === `/api/product/${PID}/stock` ? ok(product({ stock: 17 })) : productList([product()])(c),
    );
    renderAt('/admin/products');
    await userEvent.click(await screen.findByRole('button', { name: 'Stock' }));
    const input = screen.getByRole('spinbutton', { name: /change stock of dune vase/i });
    await userEvent.type(input, '-13');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('you can remove at most 12');
    expect(calls.some((c) => c.path.endsWith('/stock'))).toBe(false);

    await userEvent.clear(input);
    await userEvent.type(input, '5');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('status')).toHaveTextContent('stock increased by 5');
    expect(calls.find((c) => c.path.endsWith('/stock'))).toMatchObject({ method: 'PATCH', body: { change: 5 } });
  });

  it('asks for confirmation before deleting and shows the server’s refusal', async () => {
    signIn('ADMIN');
    const calls = mockApi((c) =>
      c.method === 'DELETE' ? fail(409, 'This product is in 1 open order. Set its stock to 0 to stop sales, and delete it once those orders are settled.') : productList([product()])(c),
    );
    renderAt('/admin/products');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm: delete Dune Vase' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('in 1 open order');
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  });

  it('validates a new product before sending, then creates it with prices in cents', async () => {
    signIn('ADMIN');
    const calls = mockApi((c) =>
      c.method === 'POST' && c.path === '/api/product/create' ? ok(product({ name: 'Linen Napkins' }), 201) : productList([product()])(c),
    );
    renderAt('/admin/products/new');
    await userEvent.click(await screen.findByRole('button', { name: 'Create product' }));
    expect(screen.getByText('Use 3–100 characters.')).toBeInTheDocument();
    expect(screen.getByText('Enter a price such as 49 or 49.50.')).toBeInTheDocument();
    expect(screen.getByText('Add 1–6 images, one per line.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Linen Napkins');
    await userEvent.type(screen.getByRole('textbox', { name: 'Price (USD)' }), '24.50');
    await userEvent.clear(screen.getByRole('spinbutton', { name: 'Stock' }));
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Stock' }), '8');
    await userEvent.type(screen.getByRole('textbox', { name: 'Images (one per line)' }), 'http://insecure.example/a.jpg');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'Ceramics');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Brand' }), 'Wadi Works');
    await userEvent.click(screen.getByRole('button', { name: 'Create product' }));
    expect(screen.getByText(/must be an https:\/\/ URL/)).toBeInTheDocument();

    await userEvent.clear(screen.getByRole('textbox', { name: 'Images (one per line)' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Images (one per line)' }), '/catalogue/napkins.jpg');
    await userEvent.click(screen.getByRole('button', { name: 'Create product' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Linen Napkins was created.');
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      name: 'Linen Napkins',
      description: '',
      images: ['/catalogue/napkins.jpg'],
      priceCents: 2450,
      discountPercent: 0,
      stock: 8,
      categoryId: 'c'.repeat(24),
      brandId: 'b'.repeat(24),
    });
  });

  it('sends only the fields that changed when editing', async () => {
    signIn('ADMIN');
    const calls = mockApi((c) => {
      if (c.method === 'GET' && c.path === `/api/product/${PID}`) return ok(product());
      if (c.method === 'PATCH' && c.path === `/api/product/${PID}`) return ok(product({ priceCents: 9000, salePriceCents: 8100 }));
      return undefined;
    });
    renderAt(`/admin/products/${PID}`);
    const price = await screen.findByRole('textbox', { name: 'Price (USD)' });
    expect(price).toHaveValue('80.00');
    await userEvent.clear(price);
    await userEvent.type(price, '90');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ priceCents: 9000 });
  });

  it('refuses the product form to a non-admin', async () => {
    signIn('DEMO_VIEWER');
    mockApi(() => undefined);
    renderAt('/admin/products/new');
    expect(await screen.findByText('Only administrators can create or edit products.')).toBeInTheDocument();
  });
});

describe('admin coupons', () => {
  it('lists coupons with discount, expiry, status and usage', async () => {
    signIn('ADMIN');
    mockApi((c) => (c.path === '/api/coupon' ? ok([coupon(), coupon({ id: 'm'.repeat(24), code: 'OLD10', status: 'EXPIRED', expired: true }), coupon({ id: 'n'.repeat(24), code: 'PAUSE5', active: false, status: 'INACTIVE' })]) : undefined));
    renderAt('/admin/coupons');
    const table = await screen.findByRole('table', { name: 'Coupons' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent(/SPRING15.*15% off.*Active.*3/);
    expect(rows[1]).toHaveTextContent('Expired');
    expect(rows[2]).toHaveTextContent('Paused');
    expect(within(rows[2]!).getByRole('button', { name: 'Activate' })).toBeInTheDocument();
  });

  it('validates and creates a coupon', async () => {
    signIn('ADMIN');
    const calls = mockApi((c) => {
      if (c.path === '/api/coupon' && c.method === 'POST') return ok(coupon({ code: 'AUTUMN20', discountPercent: 20 }), 201);
      if (c.path === '/api/coupon') return ok([]);
      return undefined;
    });
    renderAt('/admin/coupons');
    await userEvent.type(await screen.findByRole('textbox', { name: 'Code' }), 'x!');
    await userEvent.click(screen.getByRole('button', { name: 'Create coupon' }));
    expect(screen.getByText('Use 3–32 letters, digits, "-" or "_".')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    await userEvent.clear(screen.getByRole('textbox', { name: 'Code' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Code' }), 'autumn20');
    await userEvent.clear(screen.getByRole('spinbutton', { name: 'Discount %' }));
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Discount %' }), '20');
    await userEvent.click(screen.getByRole('button', { name: 'Create coupon' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Coupon AUTUMN20 was created.');
    const body = calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>;
    expect(body).toMatchObject({ code: 'autumn20', discountPercent: 20, active: true });
    expect(new Date(String(body.expiresAt)).getTime()).toBeGreaterThan(Date.now());
  });

  it('pauses a coupon and deletes one only after confirmation', async () => {
    signIn('ADMIN');
    const calls = mockApi((c) => {
      if (c.method === 'PATCH') return ok(coupon({ active: false, status: 'INACTIVE' }));
      if (c.method === 'DELETE') return ok({ deleted: true });
      if (c.path === '/api/coupon') return ok([coupon()]);
      return undefined;
    });
    renderAt('/admin/coupons');
    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    expect(await screen.findByRole('status')).toHaveTextContent('SPRING15 is now paused.');
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ active: false });

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm: delete SPRING15' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === `/api/coupon/${CID}`)).toBe(true));
  });

  it('shows a duplicate code refusal from the server', async () => {
    signIn('ADMIN');
    mockApi((c) => {
      if (c.method === 'POST' && c.path === '/api/coupon') return fail(409, 'Coupon already exists');
      if (c.path === '/api/coupon') return ok([coupon()]);
      return undefined;
    });
    renderAt('/admin/coupons');
    await userEvent.type(await screen.findByRole('textbox', { name: 'Code' }), 'spring15');
    await userEvent.click(screen.getByRole('button', { name: 'Create coupon' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Coupon already exists');
  });

  it('hides coupons from the demo viewer and shows the server’s refusal on a direct visit', async () => {
    signIn('DEMO_VIEWER');
    mockApi((c) => (c.path === '/api/coupon' ? fail(403, 'Forbidden') : undefined));
    renderAt('/admin/coupons');
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Admin sections' });
    expect(within(nav).queryByRole('link', { name: 'Coupons' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Products' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create coupon' })).not.toBeInTheDocument();
  });
});

describe('sign-in destination', () => {
  const loginAs = (role: Role) => (c: Call) =>
    c.path === '/api/auth/login'
      ? ok({ Credentials: { accessToken: 'a', refreshToken: 'r'.repeat(24) }, user: { id: 'u'.repeat(24), email: 'x@example.com', name: 'X', role, isDemo: false } })
      : c.path === '/api/admin/stats'
        ? ok({ scope: 'all', currency: 'USD', customers: 1, products: { total: 1, outOfStock: 0, lowStock: 0, lowStockThreshold: 5 }, orders: { total: 0, byStatus: {} }, simulatedPaidCents: 0, simulatedRefundedCents: 0, notice: 'n' })
        : undefined;

  it.each([
    ['ADMIN', 'Admin'],
    ['CUSTOMER', 'Your cart'],
  ] as const)('sends a %s to the right page after signing in', async (role, heading) => {
    mockApi(loginAs(role));
    renderAt('/login');
    await userEvent.type(screen.getByLabelText('Email'), 'x@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'secret-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });
});
