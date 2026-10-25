import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { getProducts, toQueryString, type Product } from '../src/api/client';
import { formatMoney } from '../src/lib/money';

const make = (over: Partial<Product>): Product => ({
  id: 'a'.repeat(24),
  name: 'Dune Vase',
  slug: 'dune-vase',
  description: 'A tall vase.',
  images: ['/catalogue/dune-vase.svg'],
  priceCents: 10000,
  discountPercent: 0,
  salePriceCents: 10000,
  currency: 'USD',
  stock: 10,
  inStock: true,
  category: { id: 'c'.repeat(24), name: 'Ceramics', slug: 'ceramics' },
  brand: { id: 'b'.repeat(24), name: 'Noor Atelier', slug: 'noor-atelier' },
  isDemo: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});
const page = (items: Product[], over = {}) => ({
  items,
  page: 1,
  limit: 8,
  total: items.length,
  totalPages: 1,
  ...over,
});
const envelope = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: true, data, timestamp: 't' }), { status });
const failure = (statusCode: number, message: string) =>
  new Response(
    JSON.stringify({ success: false, error: { statusCode, error: 'x', message }, timestamp: 't' }),
    { status: statusCode },
  );

const cats = [{ id: 'c'.repeat(24), name: 'Ceramics', slug: 'ceramics', image: null, isDemo: true, createdAt: 't' }];
const brands = [{ id: 'b'.repeat(24), name: 'Noor Atelier', slug: 'noor-atelier', image: null, isDemo: true, createdAt: 't' }];

/** Routes requests to canned API responses and records every URL called. */
function mockApi(handlers: { products?: (url: URL) => Response; product?: (id: string) => Response }) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      calls.push(url.pathname + url.search);
      if (url.pathname === '/api/health') return Promise.resolve(envelope({ status: 'ok', paymentsMode: 'simulated' }));
      if (url.pathname === '/api/category') return Promise.resolve(envelope(cats));
      if (url.pathname === '/api/brand') return Promise.resolve(envelope(brands));
      if (url.pathname === '/api/product') return Promise.resolve(handlers.products?.(url) ?? envelope(page([])));
      const id = url.pathname.split('/').pop() as string;
      return Promise.resolve(handlers.product?.(id) ?? failure(404, 'Product not found'));
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
afterEach(() => vi.unstubAllGlobals());

describe('catalogue client helpers', () => {
  it('omits unset query values', () => {
    expect(toQueryString({})).toBe('');
    expect(toQueryString({ q: '', sort: 'name', page: 2, inStock: undefined })).toBe('?sort=name&page=2');
  });
  it('encodes search text safely', () => {
    expect(toQueryString({ q: 'a&b=c d' })).toBe('?q=a%26b%3Dc+d');
  });
  it('rejects a response that is not a product page', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(envelope({ status: 'ok' }))));
    await expect(getProducts()).rejects.toThrow('Unexpected response');
  });
  it('formats cents as currency', () => {
    expect(formatMoney(7800)).toBe('$78.00');
    expect(formatMoney(5)).toBe('$0.05');
  });
});

describe('Shop', () => {
  it('lists products from the API with sale prices and badges', async () => {
    mockApi({
      products: () =>
        envelope(
          page([
            make({ id: '1'.repeat(24), name: 'Sale Bowl', priceCents: 5000, discountPercent: 20, salePriceCents: 4000 }),
            make({ id: '2'.repeat(24), name: 'Gone Lamp', stock: 0, inStock: false }),
          ]),
        ),
    });
    renderAt('/shop');
    expect(await screen.findByRole('heading', { name: 'Sale Bowl' })).toBeInTheDocument();
    expect(screen.getByText('$40.00')).toBeInTheDocument();
    expect(screen.getByLabelText('original price')).toHaveTextContent('$50.00');
    expect(screen.getByText('−20%')).toBeInTheDocument();
    expect(screen.getByText('Sold out')).toBeInTheDocument();
    expect(screen.getByText('2 pieces')).toBeInTheDocument();
  });

  it('sends the filters chosen in the URL to the API (prices converted to cents)', async () => {
    const calls = mockApi({});
    renderAt(`/shop?q=vase&category=${'c'.repeat(24)}&min=10&max=25.5&stock=1&sort=price-asc&page=2`);
    await waitFor(() => expect(calls.some((c) => c.startsWith('/api/product?'))).toBe(true));
    const url = new URL(calls.find((c) => c.startsWith('/api/product?')) as string, 'http://x');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'vase',
      categoryId: 'c'.repeat(24),
      minPrice: '1000',
      maxPrice: '2550',
      inStock: 'true',
      sort: 'price-asc',
      page: '2',
      limit: '8',
    });
  });

  it('ignores invalid URL values instead of forwarding them', async () => {
    const calls = mockApi({});
    renderAt('/shop?sort=evil&page=-4&min=abc&stock=0');
    await waitFor(() => expect(calls.some((c) => c.startsWith('/api/product?'))).toBe(true));
    const url = new URL(calls.find((c) => c.startsWith('/api/product?')) as string, 'http://x');
    expect(Object.fromEntries(url.searchParams)).toEqual({ sort: 'newest', page: '1', limit: '8' });
  });

  it('searching updates the request', async () => {
    const calls = mockApi({});
    renderAt('/shop');
    await screen.findByText(/catalogue is empty/i);
    await userEvent.type(screen.getByLabelText('Search'), 'linen');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(calls.some((c) => c.includes('q=linen'))).toBe(true));
  });

  it('shows an empty state when filters match nothing, with a way to clear', async () => {
    mockApi({});
    renderAt('/shop?q=zzz');
    expect(await screen.findByText(/Nothing matches those filters/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(await screen.findByText(/catalogue is empty/i)).toBeInTheDocument();
  });

  it('shows a clear error when the API fails', async () => {
    mockApi({ products: () => failure(503, 'Service Unavailable') });
    renderAt('/shop');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('couldn’t load the collection');
    expect(alert).toHaveTextContent('Service Unavailable');
  });

  it('paginates', async () => {
    const calls = mockApi({
      products: () => envelope(page([make({})], { totalPages: 3, total: 24 })),
    });
    renderAt('/shop');
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(calls.some((c) => c.includes('page=2'))).toBe(true));
  });

  it('does not render any payment or card input', async () => {
    mockApi({ products: () => envelope(page([make({})])) });
    const { container } = renderAt('/shop');
    await screen.findByRole('heading', { name: 'Dune Vase' });
    const inputs = [...container.querySelectorAll('input')].map((i) => i.getAttribute('type'));
    expect(inputs.every((t) => ['search', 'number', 'checkbox'].includes(t ?? ''))).toBe(true);
  });
});

describe('Product detail', () => {
  it('shows the product returned by the API', async () => {
    const product = make({ priceCents: 10000, discountPercent: 25, salePriceCents: 7500, stock: 3 });
    mockApi({ product: (id) => (id === product.id ? envelope(product) : failure(404, 'Product not found')) });
    renderAt(`/shop/${product.id}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Dune Vase' })).toBeInTheDocument();
    expect(screen.getByText('$75.00')).toBeInTheDocument();
    expect(screen.getByText('Only 3 left')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ceramics' })).toHaveAttribute('href', `/shop?category=${'c'.repeat(24)}`);
    expect(screen.getAllByText(/no payment is ever taken/i).length).toBeGreaterThan(0);
    // signed out: no purchase button, a sign-in prompt instead
    expect(screen.queryByRole('button', { name: /add to cart/i })).not.toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('switches gallery images', async () => {
    const product = make({ images: ['/catalogue/one.svg', '/catalogue/two.svg'] });
    mockApi({ product: () => envelope(product) });
    renderAt(`/shop/${product.id}`);
    const main = await screen.findByRole('img', { name: 'Dune Vase' });
    expect(main).toHaveAttribute('src', '/catalogue/one.svg');
    await userEvent.click(screen.getByRole('button', { name: 'Show image 2' }));
    expect(main).toHaveAttribute('src', '/catalogue/two.svg');
  });

  it('shows a not-found message for a missing product', async () => {
    mockApi({});
    renderAt(`/shop/${'f'.repeat(24)}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t find that piece');
    expect(screen.getByRole('link', { name: 'Back to the shop' })).toBeInTheDocument();
  });

  it('shows a different message for a server failure', async () => {
    mockApi({ product: () => failure(503, 'Service Unavailable') });
    renderAt(`/shop/${'f'.repeat(24)}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t load this piece');
  });
});

describe('Home featured products', () => {
  it('reads new arrivals from the API', async () => {
    const calls = mockApi({ products: () => envelope(page([make({ name: 'Fresh Throw' })], { limit: 4 })) });
    renderAt('/');
    const section = await screen.findByRole('region', { name: 'New arrivals' });
    expect(await within(section).findByRole('heading', { name: 'Fresh Throw' })).toBeInTheDocument();
    expect(calls).toContain('/api/product?sort=newest&limit=4');
  });

  it('shows an honest empty state, never filler products', async () => {
    mockApi({});
    renderAt('/');
    expect(await screen.findByText(/No products yet/)).toBeInTheDocument();
  });

  it('shows an error when the catalogue is down', async () => {
    mockApi({ products: () => failure(503, 'Service Unavailable') });
    renderAt('/');
    expect(await screen.findByText(/catalogue is unavailable/i)).toBeInTheDocument();
  });
});
