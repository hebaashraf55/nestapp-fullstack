import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';

const envelope = (data: unknown) => new Response(JSON.stringify({ success: true, data, timestamp: 't' }));
const emptyPage = { items: [], page: 1, limit: 4, total: 0, totalPages: 1 };
const ok = (input?: RequestInfo | URL) =>
  Promise.resolve(
    String(input).includes('/api/product')
      ? envelope(emptyPage)
      : envelope({ status: 'ok', paymentsMode: 'simulated' }),
  );

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('App', () => {
  it('shows the simulated-checkout notice on every page', () => {
    vi.stubGlobal('fetch', vi.fn(ok));
    renderAt('/about');
    expect(screen.getByRole('note')).toHaveTextContent(/checkout is simulated/i);
  });

  it('shows the API as online with the payments mode from the real contract', async () => {
    vi.stubGlobal('fetch', vi.fn(ok));
    renderAt('/');
    expect(await screen.findByText(/API online/)).toHaveTextContent('simulated');
    expect(fetch).toHaveBeenCalledWith('/api/health', expect.anything());
  });

  it('shows a clear message when the API is down', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('x'))));
    renderAt('/');
    expect(await screen.findByText(/API unavailable — Cannot reach the server/)).toBeInTheDocument();
  });

  it('navigates between pages and has a 404 route', async () => {
    vi.stubGlobal('fetch', vi.fn(ok));
    renderAt('/');
    await userEvent.click(screen.getByRole('link', { name: 'About this build' }));
    expect(await screen.findByRole('heading', { name: 'About this build' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('link', { name: 'About this build' })).toHaveAttribute('aria-current', 'page'));
  });

  it('renders a not-found page for unknown routes', () => {
    vi.stubGlobal('fetch', vi.fn(ok));
    renderAt('/nope');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('never renders a card-number or payment input', () => {
    vi.stubGlobal('fetch', vi.fn(ok));
    const { container } = renderAt('/');
    expect(container.querySelectorAll('input, textarea')).toHaveLength(0);
  });
});
