/**
 * NOMA always opens in light mode. Dark mode is an explicit visitor choice, saved in
 * localStorage; the operating-system preference is intentionally not consulted.
 * index.html applies a saved choice before first paint, so there is no flash.
 */
export type Theme = 'light' | 'dark';

export const THEME_KEY = 'noma-theme';
const THEME_COLOR: Record<Theme, string> = { light: '#f8f6f1', dark: '#1c1a17' };

export function readSavedTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light'; // storage blocked (private mode, sandboxed frame): fall back to the default
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'dark') root.dataset.theme = 'dark';
  else delete root.dataset.theme;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}

export function saveTheme(theme: Theme): void {
  try {
    if (theme === 'dark') localStorage.setItem(THEME_KEY, 'dark');
    else localStorage.removeItem(THEME_KEY);
  } catch {
    // Not persisted; the choice still applies for this page view.
  }
}
