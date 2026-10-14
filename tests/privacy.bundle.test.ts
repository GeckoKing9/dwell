import { describe, expect, it } from 'vitest';
import { BANNED_TOKENS, scanText } from '../scripts/check-privacy.ts';

describe('bundle grep', () => {
  it('reports file, line and token for each banned token', () => {
    for (const token of BANNED_TOKENS) {
      const hits = scanText('assets/x.js', `const a = 1;\nconst b = ${token}`);
      expect(hits).toContainEqual({ file: 'assets/x.js', line: 2, token });
    }
  });

  it('passes text that uses none of the banned tokens', () => {
    expect(scanText('assets/ok.js', 'export const total = 3600;\nrender(h1, root);')).toEqual([]);
  });

  it('catches a call to the global fetch inside minified code', () => {
    const hits = scanText('assets/min.js', 'var n=1;n&&fetch(`https://example.com`)');
    expect(hits.map((h) => h.token)).toContain('fetch(');
  });
});
