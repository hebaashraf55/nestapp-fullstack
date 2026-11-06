import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import type { Product } from '../src/api/client';
import { setSession } from '../src/auth/session';

const A = 'a'.repeat(24);
const product: Product = {
  id: A,
  name: 'Dune Vase',
  slug: 'dune-vase',
  description: 'd',
  images: ['/catalogue/x.jpg'],
  priceCents: 10000,
  discountPercent: 0,
  salePriceCents: 10000,
  currency: 'USD',
  stock: 10,
  inStock: true,
  category: null,
  brand: null,
  isDemo: false,
  createdAt: 't',
};
const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data, timestamp: 't' }), { status: 200 });
const fail = (s: number, message = 'no') =>
  new Response(JSON.stringify({ success: false, error: { statusCode: s, error: 'x', message }, timestamp: 't' }), { status: s });
const EMPTY_CART = { items: [], itemCount: 0, subtotalCents: 0, coupon: null, discountCents: 0, totalCents: 0, currency: 'USD', hasIssues: false, warnings: [] };
const reviews = (over = {}) => ({
  summary: { average: 4.5, count: 2, distribution: [0, 0, 0, 1, 1] },
  items: [
    { id: 'r1', authorName: 'Ada L.', rating: 5, title: 'Beautiful glaze', body: 'Heavier than expected.', verifiedPurchase: true, createdAt: '2026-01-02T00:00:00Z', updatedAt: 't' },
    { id: 'r2', authorName: 'Bo K.', rating: 4, title: 'Nice', body: 'Smaller than I thought.', verifiedPurchase: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: 't' },
  ],
  page: 1,
  limit: 5,
  total: 2,
  totalPages: 1,
  mine: null,
  ...over,
});

interface Call {
  method: string;
  path: string;
  body: unknown;
}
function mockApi(handler: (c: Call) => Response | undefined) {
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
      if (url.pathname === `/api/product/${A}`) return Promise.resolve(ok(product));
      if (url.pathname === '/api/wishlist' || url.pathname === '/api/recently-viewed') return Promise.resolve(ok({ productIds: [], items: [] }));
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

describe('product reviews', () => {
  it('shows the average, the star breakdown and approved reviews with verified purchase', async () => {
    const calls = mockApi((c) => (c.path.startsWith(`/api/product/${A}/reviews`) ? ok(reviews()) : undefined));
    renderAt(`/shop/${A}`);
    const section = await screen.findByRole('region', { name: 'Reviews' });
    expect(await within(section).findByText('4.5')).toBeInTheDocument();
    expect(within(section).getByLabelText('1 with 5 stars')).toBeInTheDocument();
    expect(within(section).getByRole('heading', { name: 'Beautiful glaze' })).toBeInTheDocument();
    expect(within(section).getAllByText(/Verified purchase/)).toHaveLength(1);
    // Guests are asked to sign in instead of seeing a form.
    expect(within(section).getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    await userEvent.selectOptions(within(section).getByLabelText('Sort'), 'lowest');
    await waitFor(() => expect(calls.some((c) => c.path.includes('sort=lowest'))).toBe(true));
  });

  it('lets a customer write a review, validating before sending, and shows it as pending', async () => {
    signIn();
    let mine: unknown = null;
    const calls = mockApi((c) => {
      if (c.method === 'POST' && c.path === `/api/product/${A}/reviews`) {
        mine = { ...(c.body as object), id: 'r9', authorName: 'Ada', verifiedPurchase: false, createdAt: 't', updatedAt: 't', productId: A, status: 'PENDING', moderationNote: null };
        return ok(mine);
      }
      if (c.path.startsWith(`/api/product/${A}/reviews`)) return ok(reviews({ summary: { average: null, count: 0, distribution: [0, 0, 0, 0, 0] }, items: [], total: 0, mine }));
      return undefined;
    });
    renderAt(`/shop/${A}`);
    const section = await screen.findByRole('region', { name: 'Reviews' });
    await userEvent.click(await within(section).findByRole('button', { name: 'Submit review' }));
    expect(within(section).getByRole('alert')).toHaveTextContent('Choose a rating');
    await userEvent.click(within(section).getByLabelText('4 stars'));
    await userEvent.type(within(section).getByLabelText('Title'), 'Lovely');
    await userEvent.type(within(section).getByLabelText('Review'), 'A lovely heavy vase.');
    await userEvent.click(within(section).getByRole('button', { name: 'Submit review' }));
    expect(await within(section).findByText(/Waiting for moderation/)).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST' && c.path.endsWith('/reviews'))!.body).toEqual({ rating: 4, title: 'Lovely', body: 'A lovely heavy vase.' });
  });

  it('shows the server’s refusal (for example a duplicate review)', async () => {
    signIn();
    mockApi((c) => {
      if (c.method === 'POST') return fail(409, 'You have already reviewed this product; edit your review instead');
      if (c.path.startsWith(`/api/product/${A}/reviews`)) return ok(reviews());
      return undefined;
    });
    renderAt(`/shop/${A}`);
    const section = await screen.findByRole('region', { name: 'Reviews' });
    await userEvent.click(await within(section).findByLabelText('5 stars'));
    await userEvent.type(within(section).getByLabelText('Title'), 'Again');
    await userEvent.type(within(section).getByLabelText('Review'), 'Trying a second time.');
    await userEvent.click(within(section).getByRole('button', { name: 'Submit review' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent('already reviewed');
  });
});

describe('review moderation (admin)', () => {
  const queue = {
    items: [{ id: 'r1', authorName: 'Ada L.', rating: 2, title: 'Chipped', body: 'Arrived with a chip.', verifiedPurchase: true, createdAt: '2026-01-02T00:00:00Z', updatedAt: 't', productId: A, status: 'PENDING', moderationNote: null, product: { id: A, name: 'Dune Vase' }, moderatedAt: null }],
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
  };

  it('approves a waiting review', async () => {
    signIn('ADMIN');
    const calls = mockApi((c) => {
      if (c.path.startsWith('/api/reviews/moderation')) return ok(queue);
      if (c.method === 'PATCH') return ok({ ...queue.items[0], status: 'APPROVED' });
      if (c.path === '/api/admin/stats') return ok({});
      return undefined;
    });
    renderAt('/admin/reviews');
    expect(await screen.findByRole('heading', { name: 'Chipped' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ path: '/api/reviews/r1/moderation', body: { status: 'APPROVED' } }));
  });

  it('is read-only for the demo viewer', async () => {
    signIn('DEMO_VIEWER');
    mockApi((c) => (c.path.startsWith('/api/reviews/moderation') ? ok(queue) : undefined));
    renderAt('/admin/reviews');
    expect(await screen.findByRole('heading', { name: 'Chipped' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });
});
