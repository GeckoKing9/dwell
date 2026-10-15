import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

const networkMessage = 'Dwell makes no network requests.';
const dynamicCodeMessage = 'Dynamic code is banned in src/.';

const privacyRules = {
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-restricted-globals': [
    'error',
    ...['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'RTCPeerConnection', 'Image', 'importScripts'].map(
      (name) => ({ name, message: networkMessage }),
    ),
  ],
  'no-restricted-properties': [
    'error',
    { object: 'navigator', property: 'sendBeacon', message: networkMessage },
    { object: 'window', property: 'open', message: networkMessage },
    { object: 'globalThis', property: 'fetch', message: networkMessage },
    { object: 'self', property: 'fetch', message: networkMessage },
    { object: 'window', property: 'fetch', message: networkMessage },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: 'MemberExpression[computed=true][object.type="Identifier"][object.name=/^(globalThis|self|window)$/]',
      message: 'Computed access on globalThis, self or window can hide a banned API.',
    },
    { selector: 'CallExpression[callee.name="eval"]', message: dynamicCodeMessage },
    { selector: 'NewExpression[callee.name="Function"]', message: dynamicCodeMessage },
    { selector: 'ImportExpression', message: dynamicCodeMessage },
    {
      selector: 'CallExpression[callee.property.name="createElement"][arguments.0.value=/^(script|link|iframe)$/i]',
      message: 'Creating script, link or iframe elements can load remote content.',
    },
  ],
};

export default defineConfig([
  globalIgnores(['dist/', 'coverage/', 'node_modules/', 'design/', 'docs/', 'test-results/', 'playwright-report/', 'handoff/']),
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx,js,mjs}'],
    rules: privacyRules,
  },
]);
