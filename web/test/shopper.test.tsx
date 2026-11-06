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
  name: id === A ? 'Dune Vase' : 'Linen Throw',
  slug: 'x',
  description: 'd',
  images: ['/catalogue/x.jpg'],
  priceCents: 10000,
  discountPercent: 0,
  salePriceCents: 10000,
  currency: 'USD',
  stock: 10,
  inStock: true,
  category: { id: 'c'.repeat(24), name: 'Ceramics', slug: 'ceramics' },
  brand: null,
  specs: { material: 'Stoneware', color: 'Oat', dimensions: '30 cm tall' },
  isDemo: false,
  createdAt: 't',
  ...over,
});
const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data, timestamp: 't' }), { status: 200 });
const fail = (s: number) => new Response(JSON.stringify({ success: false, error: { statusCode: s, error: 'x', message: 'no' }, timestamp: 't' }), { status: s });
const EMPTY_CART = { items: [], itemCount: 0, subtotalCents: 0, coupon: null, discountCents: 0, totalCents: 0, currency: 'USD', hasIssues: false, warnings: [] };

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
      if (url.pathname === '/api/cart') return Promise.resolve(ok(EMPTY_CART));
      if (url.pathname === '/api/health') return Promise.resolve(ok({ status: 'ok', paymentsMode: 'simulated' }));
      if (url.pathname === `/api/product/${A}`) return Promise.resolve(ok(product(A)));
      if (url.pathname === `/api/product/${B}`) return Promise.resolve(ok(product(B)));
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

describe('guest wishlist and history', () => {
  it('saves to this browser without calling the API, and lists saved pieces', async () => {
    const calls = mockApi();
    renderAt(`/shop/${A}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Save to wishlist' }));
    expect(screen.getByRole('button', { name: 'Saved to wishlist' })).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(localStorage.getItem('noma-wishlist')!)).toEqual([A]);
    expect(JSON.parse(localStorage.getItem('noma-recent')!)).toEqual([A]);
    expect(calls.some((c) => c.path.startsWith('/api/wishlist') || c.path.startsWith('/api/recently-viewed'))).toBe(false);
    expect(screen.getByLabelText('1 saved')).toBeInTheDocument();
    // specifications are shown on the product page
    expect(screen.getByText('Stoneware')).toBeInTheDocument();
  });

  it('ignores tampered storage', async () => {
    localStorage.setItem('noma-wishlist', JSON.stringify(['{"$ne":1}', 42, A]));
    mockApi();
    renderAt('/wishlist');
    expect(await screen.findByRole('heading', { name: 'Dune Vase' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });
});

describe('signed-in customer', () => {
  it('merges the guest lists into the account at sign-in and clears them locally', async () => {
    localStorage.setItem('noma-wishlist', JSON.stringify([A]));
    localStorage.setItem('noma-recent', JSON.stringify([B]));
    signIn();
    const calls = mockApi((c) => {
      if (c.path === '/api/wishlist/merge') return ok({ productIds: [A, B], items: [] });
      if (c.path === '/api/recently-viewed/merge') return ok({ productIds: [B], items: [] });
      return undefined;
    });
    renderAt('/wishlist');
    await waitFor(() => expect(localStorage.getItem('noma-wishlist')).toBeNull());
    expect(calls.find((c) => c.path === '/api/wishlist/merge')!.body).toEqual({ productIds: [A] });
    expect(calls.find((c) => c.path === '/api/recently-viewed/merge')!.body).toEqual({ productIds: [B] });
    expect(await screen.findAllByRole('article')).toHaveLength(2);
  });

  it('saves to the account and records views on the server', async () => {
    signIn();
    const calls = mockApi((c) => {
      if (c.path === '/api/wishlist' && c.method === 'GET') return ok({ productIds: [], items: [] });
      if (c.path === '/api/recently-viewed' && c.method === 'GET') return ok({ productIds: [], items: [] });
      if (c.path === `/api/wishlist/${A}` && c.method === 'PUT') return ok({ productIds: [A], items: [] });
      if (c.path === `/api/recently-viewed/${A}`) return ok({ productIds: [A], items: [] });
      return undefined;
    });
    renderAt(`/shop/${A}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Save to wishlist' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.path === `/api/wishlist/${A}`)).toBe(true));
    expect(calls.some((c) => c.method === 'POST' && c.path === `/api/recently-viewed/${A}`)).toBe(true);
    expect(localStorage.getItem('noma-wishlist')).toBeNull();
  });

  it('rolls the heart back when the server refuses', async () => {
    signIn();
    mockApi((c) => {
      if (c.path === '/api/wishlist' && c.method === 'GET') return ok({ productIds: [], items: [] });
      if (c.path === '/api/recently-viewed' && c.method === 'GET') return ok({ productIds: [], items: [] });
      if (c.method === 'PUT') return fail(409);
      return undefined;
    });
    renderAt(`/shop/${A}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Save to wishlist' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save to wishlist' })).toHaveAttribute('aria-pressed', 'false'));
  });
});

describe('comparison', () => {
  it('compares two pieces side by side from the server', async () => {
    localStorage.setItem('noma-compare', JSON.stringify([A, B]));
    const calls = mockApi((c) => (c.path.startsWith('/api/product/compare') ? ok([product(A), product(B, { specs: {} })]) : undefined));
    renderAt('/compare');
    const table = await screen.findByRole('table');
    expect(calls.some((c) => c.path === `/api/product/compare?ids=${A},${B}`)).toBe(true);
    const material = within(table).getByRole('row', { name: /Material/ });
    expect(material).toHaveTextContent('Stoneware');
    expect(material).toHaveTextContent('—'); // a missing spec shows a dash, not a guess
    await userEvent.click(within(table).getAllByRole('button', { name: 'Remove' })[0]!);
    expect(await screen.findByText('Add one more piece to compare.')).toBeInTheDocument();
  });

  it('holds at most four pieces', async () => {
    localStorage.setItem('noma-compare', JSON.stringify(['1', '2', '3', '4'].map((d) => d.repeat(24))));
    mockApi();
    renderAt(`/shop/${A}`);
    expect(await screen.findByRole('button', { name: 'Compare' })).toBeDisabled();
    expect(screen.getByRole('complementary', { name: 'Comparison' })).toHaveTextContent('4 pieces to compare');
  });
});
