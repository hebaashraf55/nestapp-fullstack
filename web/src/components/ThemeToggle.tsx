import { useEffect, useState } from 'react';
import { applyTheme, readSavedTheme, saveTheme, THEME_KEY, type Theme } from '../theme/theme';

/** Header switch between the default light theme and the optional dark theme. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readSavedTheme);

  useEffect(() => applyTheme(theme), [theme]);

  // Keep other open tabs in step when the choice changes in one of them.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY || e.key === null) setTheme(readSavedTheme());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const dark = theme === 'dark';
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-pressed={dark}
      onClick={() => {
        const next: Theme = dark ? 'light' : 'dark';
        saveTheme(next);
        setTheme(next);
      }}
    >
      <span className="theme-toggle__icon" aria-hidden="true" />
      Dark mode
    </button>
  );
}
