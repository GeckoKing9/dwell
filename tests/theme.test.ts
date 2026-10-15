import { describe, expect, it } from 'vitest';
import { applyTheme, themeOf } from '../src/shared/theme.ts';

function fakeRoot() {
  const attrs = new Map<string, string>();
  return {
    attrs,
    setAttribute: (name: string, value: string) => void attrs.set(name, value),
    removeAttribute: (name: string) => void attrs.delete(name),
    getAttribute: (name: string) => attrs.get(name) ?? null,
  };
}

describe('applyTheme', () => {
  it('sets data-theme for light and dark, changes it, and removes it for system', () => {
    const root = fakeRoot();
    applyTheme(root, 'dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
    applyTheme(root, 'light');
    expect(root.getAttribute('data-theme')).toBe('light');
    applyTheme(root, 'system');
    expect(root.getAttribute('data-theme')).toBeNull();
  });

  it('leaves system alone when the attribute was never set', () => {
    const root = fakeRoot();
    applyTheme(root, 'system');
    expect(root.attrs.size).toBe(0);
  });
});

describe('themeOf', () => {
  it('reads the stored theme and falls back to system for a missing or invalid value', () => {
    expect(themeOf({ theme: 'dark' })).toBe('dark');
    expect(themeOf(undefined)).toBe('system');
    expect(themeOf({ theme: 'neon' })).toBe('system');
    expect(themeOf({})).toBe('system');
  });
});
