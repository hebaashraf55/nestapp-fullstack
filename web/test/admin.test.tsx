import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import type { AdminOrder, AdminStats, AuditEntry, OrderStatus } from '../src/api/client';
import { type Role, setSession } from '../src/auth/session';

const signIn = (role: Role) =>
  setSession({
    accessToken: 'access-1',
    refreshToken: 'refresh-1-aaaaaaaaaaaa',
    user: { id: 'u'.repeat(24), email: 's@example.com', name: 'Staff', role, isDemo: role === 'DEMO_VIEWER' },
  });

const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data, timestamp: 't' }), { status });
const fail = (statusCode: number, message: string) =>
  new Response(JSON.stringify({ success: false, error: { statusCode, error: 'x', message }, timestamp: 't' }), { status: statusCode });

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
      const call: Call = {
        method: init?.method ?? 'GET',
        path: url.pathname,
        search: url.search,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const custom = handler(call);
      if (custom) return Promise.resolve(custom);
      if (url.pathname === '/api/health') return Promise.resolve(ok({ status: 'ok', paymentsMode: 'simulated' }));
      if (url.pathname === '/api/cart')
        return Promise.resolve(ok({ items: [], itemCount: 0, subtotalCents: 0, coupon: null, discountCents: 0, totalCents: 0, currency: 'USD', hasIssues: false, warnings: [] }));
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

const NOTICE = 'Simulated payment: no payment was taken and no card was charged.';
const stats = (over: Partial<AdminStats> = {}): AdminStats => ({
  scope: 'all',
  currency: 'USD',
  customers: 12,
  products: { total: 30, outOfStock: 2, lowStock: 4, lowStockThreshold: 5 },
  orders: { total: 9, byStatus: { PENDING_PAYMENT: 1, PAID: 3, SHIPPED: 2, DELIVERED: 1, CANCELLED: 1, EXPIRED: 1 } },
  simulatedPaidCents: 123456,
  simulatedRefundedCents: 7000,
  notice: NOTICE,
  ...over,
});
const adminOrder = (id: string, status: OrderStatus, over: Partial<AdminOrder> = {}): AdminOrder =>
  ({
    id,
    status,
    paymentStatus: status === 'PENDING_PAYMENT' ? 'SIMULATED_UNPAID' : 'SIMULATED_PAID',
    items: [{ productId: 'p'.repeat(24), name: 'Dune Vase', unitPriceCents: 8000, quantity: 2, lineTotalCents: 16000 }],
    subtotalCents: 16000,
    coupon: null,
    discountCents: 0,
    totalCents: 16000,
    currency: 'USD',
    address: '12 Nile Street',
    phone: '+20100',
    expiresAt: 't',
    paidAt: null,
    refundedAt: null,
    cancelledAt: null,
    createdAt: new Date('2026-10-20T10:00:00Z').toISOString(),
    isDemo: false,
    payment: { mode: 'SIMULATED', notice: NOTICE },
    customer: { id: 'c'.repeat(24), displayName: 'Heba A.', maskedEmail: 'h***@e***.com' },
    ...over,
  }) as AdminOrder;
const page = <T,>(items: T[], over: object = {}) => ({ items, page: 1, limit: 10, total: items.length, totalPages: 1, ...over });
const OID = 'a'.repeat(18) + 'ABC123'.toLowerCase();

beforeEach(() => setSession(null));
afterEach(() => {
  vi.unstubAllGlobals();
  setSession(null);
});

describe('admin area access', () => {
  it('asks signed-out visitors to sign in and makes no admin request', async () => {
    const calls = mockApi(() => undefined);
    renderAt('/admin');
    expect(await screen.findByText(/with a staff account/i)).toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/api/admin'))).toBe(false);
  });

  it('tells a customer they have no access and makes no admin request', async () => {
    signIn('CUSTOMER');
    const calls = mockApi(() => undefined);
    renderAt('/admin/orders');
    expect(await screen.findByRole('alert')).toHaveTextContent(/does not have access/i);
    expect(calls.some((c) => c.path.startsWith('/api/admin'))).toBe(false);
  });

  it('still shows the server’s refusal if a customer’s request reaches the API (403)', async () => {
    signIn('ADMIN'); // pretend the UI let it through; the server says no
    mockApi((c) => (c.path === '/api/admin/stats' ? fail(403, 'Forbidden') : undefined));
    renderAt('/admin');
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });

  it('shows the right navigation for each role', async () => {
    mockApi(() => undefined);
    signIn('CUSTOMER');
    const customer = renderAt('/');
    const nav = await screen.findByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: 'Orders' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
    customer.unmount();
    signIn('ADMIN');
    const admin = renderAt('/');
    const nav2 = await screen.findByRole('navigation', { name: 'Primary' });
    expect(within(nav2).getByRole('link', { name: 'Admin' })).toBeInTheDocument();
    admin.unmount();
    signIn('DEMO_VIEWER');
    renderAt('/');
    const nav3 = await screen.findByRole('navigation', { name: 'Primary' });
    expect(within(nav3).getByRole('link', { name: 'Admin' })).toBeInTheDocument();
  });
});

describe('dashboard', () => {
  it('shows the figures the API returned, labelled as simulated', async () => {
    signIn('ADMIN');
    mockApi((c) => (c.path === '/api/admin/stats' ? ok(stats()) : undefined));
    renderAt('/admin');
    expect(await screen.findByText('$1,234.56')).toBeInTheDocument();
    expect(screen.getByText('Simulated paid')).toBeInTheDocument();
    expect(screen.getByText('$70.00')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText(/no payment was taken/i)).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /Paid \(simulated\)/ });
    expect(within(row).getByText('3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Audit log' })).toBeInTheDocument();
  });

  it('for the demo viewer says it is synthetic, read-only, and hides the audit log link', async () => {
    signIn('DEMO_VIEWER');
    mockApi((c) => (c.path === '/api/admin/stats' ? ok(stats({ scope: 'demo' })) : undefined));
    renderAt('/admin');
    expect(await screen.findByText(/synthetic demo records only/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot change anything/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument();
  });

  it('shows a readable error when the API fails', async () => {
    signIn('ADMIN');
    mockApi((c) => (c.path === '/api/admin/stats' ? fail(503, 'Service Unavailable') : undefined));
    renderAt('/admin');
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t load this/i);
  });

  it('rejects a malformed response instead of rendering nonsense', async () => {
    signIn('ADMIN');
    mockApi((c) => (c.path === '/api/admin/stats' ? ok({ hello: 'world' }) : undefined));
    renderAt('/admin');
    expect(await screen.findByRole('alert')).toHaveTextContent(/unexpected response/i);
  });
});

describe('admin orders', () => {
  it('lists orders with masked customers and offers the actions the state machine allows', async () => {
    signIn('ADMIN');
    mockApi((c) =>
      c.path === '/api/admin/orders'
        ? ok(
            page([
              adminOrder('1'.repeat(24), 'PENDING_PAYMENT'),
              adminOrder('2'.repeat(24), 'PAID'),
              adminOrder('3'.repeat(24), 'SHIPPED'),
              adminOrder('4'.repeat(24), 'DELIVERED'),
              adminOrder('5'.repeat(24), 'EXPIRED'),
            ]),
          )
        : undefined,
    );
    renderAt('/admin/orders');
    const rows = await screen.findAllByRole('listitem');
    const text = (i: number) => rows[i]!.textContent ?? '';
    expect(text(0)).toContain('h***@e***.com');
    const buttons = (i: number) => within(rows[i]!).queryAllByRole('button').map((b) => b.textContent);
    expect(buttons(0)).toEqual(['Cancel order']);
    expect(buttons(1)).toEqual(['Mark shipped', 'Refund (simulated)']);
    expect(buttons(2)).toEqual(['Mark delivered']);
    expect(buttons(3)).toEqual([]);
    expect(buttons(4)).toEqual([]);
    expect(document.body.textContent).not.toContain('12 Nile Street');
  });

  it('marks an order shipped with exactly { status: "SHIPPED" } and then reloads', async () => {
    signIn('ADMIN');
    let shipped = false;
    const calls = mockApi((c) => {
      if (c.method === 'PATCH') {
        shipped = true;
        return ok(adminOrder(OID, 'SHIPPED'));
      }
      if (c.path === '/api/admin/orders') return ok(page([adminOrder(OID, shipped ? 'SHIPPED' : 'PAID')]));
      return undefined;
    });
    const user = userEvent.setup();
    renderAt('/admin/orders');
    await user.click(await screen.findByRole('button', { name: 'Mark shipped' }));
    expect(await screen.findByRole('button', { name: 'Mark delivered' })).toBeInTheDocument();
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch).toMatchObject({ path: `/api/order/${OID}/status`, body: { status: 'SHIPPED' } });
  });

  it('asks for confirmation before a refund and sends an empty body only after it', async () => {
    signIn('ADMIN');
    const calls = mockApi((c) => {
      if (c.method === 'POST') return ok(adminOrder(OID, 'CANCELLED'));
      if (c.path === '/api/admin/orders') return ok(page([adminOrder(OID, 'PAID')]));
      return undefined;
    });
    const user = userEvent.setup();
    renderAt('/admin/orders');
    await user.click(await screen.findByRole('button', { name: 'Refund (simulated)' }));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Keep order' }));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Refund (simulated)' }));
    await user.click(screen.getByRole('button', { name: 'Confirm: Refund (simulated)' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({ path: `/api/order/${OID}/refund`, body: {} });
  });

  it('shows the server’s conflict message and reloads the real state', async () => {
    signIn('ADMIN');
    const calls = mockApi((c) => {
      if (c.method === 'PATCH') return fail(409, 'An order that is CANCELLED cannot be set to SHIPPED');
      if (c.path === '/api/admin/orders') return ok(page([adminOrder(OID, 'PAID')]));
      return undefined;
    });
    const user = userEvent.setup();
    renderAt('/admin/orders');
    await user.click(await screen.findByRole('button', { name: 'Mark shipped' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot be set to SHIPPED');
    expect(calls.filter((c) => c.path === '/api/admin/orders').length).toBeGreaterThanOrEqual(2);
  });

  it('filters by status through the API and goes back to page 1', async () => {
    signIn('ADMIN');
    const calls = mockApi((c) => (c.path === '/api/admin/orders' ? ok(page([adminOrder(OID, 'PAID')], { totalPages: 3, total: 25 })) : undefined));
    const user = userEvent.setup();
    renderAt('/admin/orders');
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    await waitFor(() => expect(calls.some((c) => c.search.includes('page=2'))).toBe(true));
    await user.selectOptions(screen.getByLabelText('Status'), 'PAID');
    await waitFor(() => expect(calls.some((c) => c.search.includes('status=PAID') && c.search.includes('page=1'))).toBe(true));
  });

  it('gives the demo viewer the list but no action buttons', async () => {
    signIn('DEMO_VIEWER');
    mockApi((c) => (c.path === '/api/admin/orders' ? ok(page([adminOrder(OID, 'PAID', { isDemo: true })])) : undefined));
    renderAt('/admin/orders');
    const row = (await screen.findAllByRole('listitem'))[0]!;
    expect(within(row).queryAllByRole('button')).toHaveLength(0);
  });

  it('shows an empty state', async () => {
    signIn('ADMIN');
    mockApi((c) => (c.path === '/api/admin/orders' ? ok(page([])) : undefined));
    renderAt('/admin/orders');
    expect(await screen.findByText(/no orders match/i)).toBeInTheDocument();
  });
});

describe('customers and audit log', () => {
  it('renders only masked customer data and pages through results', async () => {
    signIn('ADMIN');
    const calls = mockApi((c) =>
      c.path === '/api/admin/customers'
        ? ok(
            page(
              [
                { id: '1'.repeat(24), displayName: 'Heba A.', maskedEmail: 'h***@e***.com', emailVerified: true, isDemo: false, createdAt: '2026-10-01T00:00:00Z' },
                { id: '2'.repeat(24), displayName: 'Demo S.', maskedEmail: 'd***@e***.com', emailVerified: false, isDemo: true, createdAt: '2026-10-02T00:00:00Z' },
              ],
              { totalPages: 2, total: 12 },
            ),
          )
        : undefined,
    );
    const user = userEvent.setup();
    renderAt('/admin/customers');
    expect(await screen.findByText('h***@e***.com')).toBeInTheDocument();
    expect(screen.getByText('demo')).toBeInTheDocument();
    expect(screen.getByText(/page 1 of 2 · 12 records/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(calls.some((c) => c.search.includes('page=2'))).toBe(true));
  });

  it('renders the audit log for an admin', async () => {
    signIn('ADMIN');
    const entry: AuditEntry = { id: 'e1', actorId: 'f'.repeat(24), actorRole: 'ADMIN', action: 'order.status', targetId: OID, detail: 'SHIPPED', createdAt: '2026-10-25T09:00:00Z' };
    mockApi((c) => (c.path === '/api/admin/audit' ? ok(page([entry])) : undefined));
    renderAt('/admin/audit');
    expect(await screen.findByRole('rowheader', { name: 'order.status' })).toBeInTheDocument();
    expect(screen.getByText('SHIPPED')).toBeInTheDocument();
    expect(screen.getByText(/cannot be edited or deleted/i)).toBeInTheDocument();
  });

  it('shows the server’s refusal when the demo viewer opens the audit URL directly', async () => {
    signIn('DEMO_VIEWER');
    mockApi((c) => (c.path === '/api/admin/audit' ? fail(403, 'Forbidden') : undefined));
    renderAt('/admin/audit');
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });

  it('has an empty audit state', async () => {
    signIn('ADMIN');
    mockApi((c) => (c.path === '/api/admin/audit' ? ok(page([])) : undefined));
    renderAt('/admin/audit');
    expect(await screen.findByText(/nothing has been recorded/i)).toBeInTheDocument();
  });
});
