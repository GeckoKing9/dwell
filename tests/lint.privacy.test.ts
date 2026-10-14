import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: new URL('..', import.meta.url).pathname });

async function ruleIds(code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: 'src/probe.ts' });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'parse-error');
}

const banned: [string, string, string][] = [
  ['computed self access', "self['fe' + 'tch']('https://example.com');", 'no-restricted-syntax'],
  ['computed globalThis access', 'const name = "fetch"; globalThis[name];', 'no-restricted-syntax'],
  ['computed window access', 'declare const expr: string; window[expr];', 'no-restricted-syntax'],
  ['eval', "eval('1');", 'no-restricted-syntax'],
  ['new Function', "new Function('return 1');", 'no-restricted-syntax'],
  ['dynamic import', "void import('./x.js');", 'no-restricted-syntax'],
  ['createElement script', "document.createElement('script');", 'no-restricted-syntax'],
  ['createElement iframe', "document.createElement('IFRAME');", 'no-restricted-syntax'],
  ['global fetch', "void fetch('https://example.com');", 'no-restricted-globals'],
  ['XMLHttpRequest', 'new XMLHttpRequest();', 'no-restricted-globals'],
  ['WebSocket', "new WebSocket('wss://example.com');", 'no-restricted-globals'],
  ['new Image', 'new Image();', 'no-restricted-globals'],
  ['self.fetch', "void self.fetch('https://example.com');", 'no-restricted-properties'],
  ['sendBeacon', "navigator.sendBeacon('https://example.com');", 'no-restricted-properties'],
  ['window.open', "window.open('https://example.com');", 'no-restricted-properties'],
];

describe('privacy lint rules in src/', () => {
  it.each(banned)('flags %s', async (_label, code, rule) => {
    expect(await ruleIds(code)).toContain(rule);
  });

  it('allows ordinary DOM code', async () => {
    expect(await ruleIds("const el = document.createElement('div');\nel.textContent = 'Dwell';\n")).toEqual([]);
  });
});
