import { DEFAULT_SETTINGS } from '../store/schema.ts';
import type { Theme } from '../store/schema.ts';
import { validateSettings } from './settings.ts';

/** The slice of an element `applyTheme` needs; kept this small so tests can pass a plain object. */
export interface ThemeRoot {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** Forces light or dark through `data-theme`; `system` removes it so the media query decides. */
export function applyTheme(root: ThemeRoot, theme: Theme): void {
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/** The theme inside a stored settings value; anything missing or invalid reads as the default. */
export function themeOf(stored: unknown): Theme {
  const result = validateSettings(stored === undefined ? {} : stored);
  return result.ok ? result.value.theme : DEFAULT_SETTINGS.theme;
}
