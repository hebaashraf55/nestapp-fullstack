import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { readSavedTheme, THEME_KEY } from '../src/theme/theme';

const envelope = (data: unknown) => new Response(JSON.stringify({ success: true, data, timestamp: 't' }));
const emptyPage = { items: [], page: 1, limit: 4, total: 0, totalPages: 1 };
const ok = (input?: RequestInfo | URL) =>
  Promise.resolve(
    /\/api\/(category|brand)/.test(String(input))
      ? envelope([])
      : String(input).includes('/api/product')
        ? envelope(emptyPage)
        : envelope({ status: 'ok', paymentsMode: 'simulated' }),
  );

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
const root = () => document.documentElement;
const toggle = () => screen.getByRole('button', { name: 'Dark mode' });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(ok));
  // The operating system asks for dark: NOMA must ignore it.
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('dark'), media: q, addEventListener() {}, removeEventListener() {} }));
  localStorage.clear();
  delete root().dataset.theme;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('theme', () => {
  it('opens in light mode even when the operating system prefers dark', () => {
    renderAt('/');
    expect(root().dataset.theme).toBeUndefined();
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches to dark only when the visitor chooses it, and saves the choice', async () => {
    renderAt('/');
    await userEvent.click(toggle());
    expect(root().dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the chosen theme across navigation and a fresh page load', async () => {
    const first = renderAt('/');
    await userEvent.click(toggle());
    await userEvent.click(screen.getByRole('link', { name: 'Shop' }));
    expect(root().dataset.theme).toBe('dark');

    first.unmount(); // simulate a refresh: a new app instance reads the saved choice
    renderAt('/shop');
    expect(root().dataset.theme).toBe('dark');
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
  });

  it('returns to light and forgets the choice when toggled back', async () => {
    localStorage.setItem(THEME_KEY, 'dark');
    renderAt('/');
    await userEvent.click(toggle());
    expect(root().dataset.theme).toBeUndefined();
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it('falls back to light when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readSavedTheme()).toBe('light');
  });
});
