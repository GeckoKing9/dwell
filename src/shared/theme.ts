import type { Theme } from '../store/schema.ts';
import { repairSettings } from './settings.ts';

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

/** The theme inside a stored settings value, read field by field: a bad field elsewhere never hides it. */
export function themeOf(stored: unknown): Theme {
  return repairSettings(stored).theme;
}
