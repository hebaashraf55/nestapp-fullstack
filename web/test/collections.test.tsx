import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import type { Product } from '../src/api/client';
import { setSession } from '../src/auth/session';

const A = 'a'.repeat(24);
const B = 'b'.repeat(24);
const product = (id: string, over: Partial<Product> = {}): Product => ({
  id,
  name: id === A ? 'Linen Throw Sage' : 'Linen Throw Oat',
  slug: 'x',
  description: 'd',
  images: ['/catalogue/x.jpg'],
  priceCents: 5000,
  discountPercent: 0,
  salePriceCents: 5000,
  currency: 'USD',
  stock: 5,
  inStock: true,
  category: null,
  brand: null,
  isDemo: false,
  createdAt: 't',
  ...over,
});
const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data, timestamp: 't' }), { status });
const fail = (s: number, message = 'no') =>
  new Response(JSON.stringify({ success: false, error: { statusCode: s, error: 'x', message }, timestamp: 't' }), { status: s });
const cart = (over = {}) => ({ items: [], itemCount: 0, subtotalCents: 0, bundles: [], bundleSavingsCents: 0, coupon: null, discountCents: 0, totalCents: 0, currency: 'USD', hasIssues: false, warnings: [], ...over });
const bundle = {
  id: 'bnd1',
  name: 'Throw Pair',
  slug: 'throw-pair',
  description: 'Two throws.',
  image: null,
  discountPercent: 10,
  active: true,
  items: [
    { product: product(A), quantity: 1 },
    { product: product(B), quantity: 1 },
  ],
  itemsTotalCents: 10000,
  priceCents: 9000,
  savingsCents: 1000,
  available: true,
  createdAt: 't',
};
const look = { id: 'lk1', title: 'Quiet Bedroom', slug: 'quiet-bedroom', description: 'Soft linen.', image: '/catalogue/y.jpg', active: true, spots: [{ product: product(A), x: 40, y: 50 }, { product: product(B, { stock: 0, inStock: false }), x: null, y: null }], totalCents: 10000, createdAt: 't' };

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
      if (url.pathname.endsWith('/reviews')) return Promise.resolve(ok({ summary: { average: null, count: 0, distribution: [0, 0, 0, 0, 0] }, items: [], page: 1, limit: 5, total: 0, totalPages: 1, mine: null }));
      if (url.pathname === '/api/bundles' || url.pathname === '/api/looks') return Promise.resolve(ok([]));
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
});

describe('variants', () => {
  it('shows every option as a link, marking the current one and sold-out ones', async () => {
    const detail = product(A, {
      variantGroup: 'linen-throw',
      variantLabel: 'Sage',
      variants: [
        { id: B, label: 'Oat', salePriceCents: 5000, inStock: false, image: null },
        { id: A, label: 'Sage', salePriceCents: 5000, inStock: true, image: null },
      ],
    });
    mockApi((c) => (c.path === `/api/product/${A}` ? ok(detail) : undefined));
    renderAt(`/shop/${A}`);
    const options = await screen.findByRole('group', { name: 'Options' });
    expect(within(options).getByRole('link', { name: 'Sage' })).toHaveAttribute('aria-current', 'true');
    expect(within(options).getByRole('link', { name: 'Oat (sold out)' })).toHaveAttribute('href', `/shop/${B}`);
  });
});

describe('sets', () => {
  it('shows the server’s set price and adds the whole set in one request', async () => {
    signIn();
    const calls = mockApi((c) => {
      if (c.path.startsWith('/api/bundles')) return ok([bundle]);
      if (c.path === '/api/cart/batch') return ok(cart({ itemCount: 2, bundleSavingsCents: 1000 }), 201);
      return undefined;
    });
    renderAt('/sets');
    const card = await screen.findByRole('article', { name: 'Throw Pair' });
    expect(within(card).getByText('$90.00')).toBeInTheDocument();
    expect(within(card).getByText('Save $10.00')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Add the set' }));
    expect(await within(card).findByText(/Added\./)).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/cart/batch')!.body).toEqual({
      items: [
        { productId: A, quantity: 1 },
        { productId: B, quantity: 1 },
      ],
    });
  });

  it('lists the bundle savings in the cart summary', async () => {
    signIn();
    mockApi((c) =>
      c.path === '/api/cart'
        ? ok(
            cart({
              items: [{ productId: A, name: 'Linen Throw Sage', slug: 'x', image: null, quantity: 1, unitPriceCents: 5000, lineTotalCents: 5000, availableStock: 5, status: 'ok' }],
              itemCount: 1,
              subtotalCents: 5000,
              bundles: [{ bundleId: 'bnd1', name: 'Throw Pair', times: 1, discountPercent: 10, savingsCents: 500 }],
              bundleSavingsCents: 500,
              totalCents: 4500,
            }),
          )
        : undefined,
    );
    renderAt('/cart');
    const summary = await screen.findByRole('complementary', { name: 'Order summary' });
    expect(within(summary).getByText(/Throw Pair/)).toBeInTheDocument();
    expect(within(summary).getByText('−$5.00')).toBeInTheDocument();
  });
});

describe('Shop the Look', () => {
  it('places numbered spots and adds only the pieces in stock', async () => {
    signIn();
    const calls = mockApi((c) => {
      if (c.path === '/api/looks/quiet-bedroom') return ok(look);
      if (c.path === '/api/cart/batch') return ok(cart({ itemCount: 1 }), 201);
      return undefined;
    });
    renderAt('/looks/quiet-bedroom');
    expect(await screen.findByRole('heading', { name: 'Quiet Bedroom' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Piece 1: Linen Throw Sage' })).toHaveStyle({ left: '40%', top: '50%' });
    await userEvent.click(screen.getByRole('button', { name: 'Add the 1 pieces in stock' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/api/cart/batch')!.body).toEqual({ items: [{ productId: A, quantity: 1 }] }));
  });

  it('says so when a look does not exist', async () => {
    mockApi();
    renderAt('/looks/nope');
    expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t find that look');
  });
});

describe('moodboards', () => {
  const board = { id: 'm'.repeat(24), name: 'Calm bedroom', note: '', productIds: [A], products: [product(A)], sharePath: null, createdAt: 't', updatedAt: 't' };

  it('asks guests to sign in', async () => {
    mockApi();
    renderAt('/moodboards');
    expect(await within(screen.getByRole('main')).findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('creates a share link and can stop sharing it', async () => {
    signIn();
    const shared = { ...board, sharePath: `/moodboards/shared/${'c'.repeat(32)}` };
    const calls = mockApi((c) => {
      if (c.path === `/api/moodboards/${board.id}` && c.method === 'GET') return ok(board);
      if (c.path.endsWith('/share') && c.method === 'POST') return ok(shared);
      if (c.path.endsWith('/share') && c.method === 'DELETE') return ok(board);
      return undefined;
    });
    renderAt(`/moodboards/${board.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Create share link' }));
    expect(await screen.findByRole('link', { name: /moodboards\/shared\/c{32}/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    expect(await screen.findByRole('button', { name: 'Create share link' })).toBeInTheDocument();
    expect(calls.filter((c) => c.path.endsWith('/share')).map((c) => c.method)).toEqual(['POST', 'DELETE']);
  });

  it('shows a shared board read-only, and a clear message for a dead link', async () => {
    mockApi((c) =>
      c.path === `/api/moodboards/shared/${'c'.repeat(32)}` ? ok({ name: 'Calm bedroom', note: 'Soft tones', products: [product(A)], updatedAt: 't' }) : undefined,
    );
    renderAt(`/moodboards/shared/${'c'.repeat(32)}`);
    expect(await screen.findByRole('heading', { name: 'Calm bedroom' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove from board/ })).not.toBeInTheDocument();
  });

  it('pins a product from its page to a new board', async () => {
    signIn();
    const calls = mockApi((c) => {
      if (c.path === `/api/product/${A}`) return ok(product(A));
      if (c.path === '/api/moodboards' && c.method === 'GET') return ok([]);
      if (c.path === '/api/moodboards' && c.method === 'POST') return ok({ ...board, productIds: [], products: [] }, 201);
      if (c.method === 'PUT') return ok(board);
      return undefined;
    });
    renderAt(`/shop/${A}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Save to moodboard' }));
    await userEvent.type(await screen.findByLabelText('New moodboard name'), 'Calm bedroom');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText(/Saved to “Calm bedroom”/)).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PUT')!.path).toBe(`/api/moodboards/${board.id}/products/${A}`);
  });
});
