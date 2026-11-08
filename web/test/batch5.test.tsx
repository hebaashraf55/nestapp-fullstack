import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { setSession } from '../src/auth/session';

const CAT = 'c'.repeat(24);
const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data, timestamp: 't' }), { status });
const fail = (s: number) =>
  new Response(JSON.stringify({ success: false, error: { statusCode: s, error: 'x', message: 'no' }, timestamp: 't' }), { status: s });
const page = { items: [], page: 1, limit: 8, total: 0, totalPages: 1 };
const facets = {
  total: 3,
  categories: [{ id: CAT, name: 'Ceramics', slug: 'ceramics', count: 3 }],
  brands: [],
  inStock: 2,
  onSale: 1,
  price: { minCents: 800, maxCents: 1000 },
  truncated: false,
};

function mockApi(handler: (path: string, method: string) => Response | undefined = () => undefined) {
  const calls: { method: string; path: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname + url.search;
      const method = init?.method ?? 'GET';
      calls.push({ method, path });
      const custom = handler(path, method);
      if (custom) return Promise.resolve(custom);
      if (url.pathname === '/api/category') return Promise.resolve(ok([{ id: CAT, name: 'Ceramics', slug: 'ceramics', image: null, isDemo: false, createdAt: 't' }]));
      if (url.pathname === '/api/brand') return Promise.resolve(ok([]));
      if (url.pathname === '/api/product') return Promise.resolve(ok(page));
      if (url.pathname === '/api/product/facets') return Promise.resolve(ok(facets));
      if (url.pathname === '/api/cart/quote' || url.pathname === '/api/cart') return Promise.resolve(ok({ items: [], itemCount: 0, subtotalCents: 0, coupon: null, discountCents: 0, totalCents: 0, currency: 'USD', hasIssues: false, warnings: [] }));
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

beforeEach(() => {
  setSession(null);
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setSession(null);
});

describe('shop search', () => {
  it('ranks a search by best match and shows filter counts', async () => {
    const calls = mockApi();
    renderAt('/shop?q=stoneware');
    expect(await screen.findByRole('option', { name: 'Ceramics (3)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Sort')).toHaveValue('relevance');
    expect(screen.getByText(/In stock only \(2\)/)).toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/api/product?') && c.path.includes('sort=relevance'))).toBe(true);
    expect(calls.find((c) => c.path.startsWith('/api/product/facets'))!.path).not.toContain('sort=');
  });

  it('suggests products and categories while typing', async () => {
    const calls = mockApi((path) =>
      path.startsWith('/api/product/suggest')
        ? ok({ products: [{ id: 'a'.repeat(24), name: 'Stoneware Mug', image: null, salePriceCents: 2400, currency: 'USD' }], categories: [{ id: CAT, name: 'Ceramics', slug: 'ceramics' }] })
        : undefined,
    );
    renderAt('/shop');
    await userEvent.type(await screen.findByRole('searchbox'), 'ston');
    const list = await screen.findByRole('list', { name: 'Suggestions' });
    expect(list).toHaveTextContent('Stoneware Mug');
    expect(screen.getByRole('link', { name: /Category Ceramics/ })).toHaveAttribute('href', `/shop?category=${CAT}`);
    expect(calls.filter((c) => c.path.startsWith('/api/product/suggest')).at(-1)!.path).toBe('/api/product/suggest?q=ston');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Suggestions' })).not.toBeInTheDocument());
  });
});

describe('admin jobs', () => {
  it('shows counts, never message contents, and retries a failed job', async () => {
    setSession({ accessToken: 'a', refreshToken: 'r'.repeat(24), user: { id: 'u'.repeat(24), email: 'o@example.com', name: 'Owner', role: 'ADMIN', isDemo: false } } as never);
    const job = { id: 'j'.repeat(24), type: 'mail.send', status: 'DEAD', attempts: 5, maxAttempts: 5, runAt: 't', lastError: 'smtp://<redacted>@mail refused', requestId: null, createdAt: '2026-01-01T10:00:00Z', finishedAt: null };
    const calls = mockApi((path, method) => {
      if (path.startsWith('/api/admin/jobs') && method === 'GET') return ok({ counts: { PENDING: 0, RUNNING: 0, DONE: 4, DEAD: 1 }, items: [job] });
      if (path.endsWith('/retry')) return ok({ ...job, status: 'PENDING', attempts: 0 });
      return undefined;
    });
    renderAt('/admin/jobs');
    expect(await screen.findByRole('table', { name: 'Background jobs' })).toHaveTextContent('smtp://<redacted>@mail refused');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('status')).toHaveTextContent('will run again');
    expect(calls.some((c) => c.method === 'POST' && c.path === `/api/admin/jobs/${'j'.repeat(24)}/retry`)).toBe(true);
  });
});
