import { describe, expect, it } from 'vitest';
import { isPopUpPath, openRequest, readOpenAnswer, readOpenRequest } from '../src/blocker/bridge.ts';

const CODE = 'DeewiSPpCrm';

describe('openRequest and readOpenRequest: what the guard asks the page-world bridge', () => {
  it.each(['pop-up', 'page', 'swap'] as const)('round-trips a %s request for a post path', (mode) => {
    expect(readOpenRequest(openRequest(mode, `/p/${CODE}/`))).toEqual({ mode, path: `/p/${CODE}/` });
  });

  it.each([
    null,
    42,
    '',
    `/p/${CODE}/`,
    `pop-up /reel/${CODE}/`,
    `page /p/${CODE}/?next=/evil`,
    `tab /p/${CODE}/`,
    `pop-up  /p/${CODE}/`,
    `pop-up /p/${CODE}/ extra`,
  ])('refuses %j', (detail) => {
    expect(readOpenRequest(detail)).toBeNull();
  });
});

describe('readOpenAnswer: how the bridge says it opened the post', () => {
  it('reads the three answers and treats anything else as refused', () => {
    expect(readOpenAnswer('pop-up')).toBe('pop-up');
    expect(readOpenAnswer('page')).toBe('page');
    expect(readOpenAnswer('refused')).toBe('refused');
    for (const other of [null, '', 'opened', 'PAGE']) expect(readOpenAnswer(other)).toBe('refused');
  });
});

describe('isPopUpPath: the one path form the bridge opens', () => {
  it('accepts only /p/<code>/', () => {
    expect(isPopUpPath(`/p/${CODE}/`)).toBe(true);
    for (const bad of [
      `/p/${CODE}`,
      `/reel/${CODE}/`,
      `/p/${CODE}/?x=1`,
      `//evil.example/p/${CODE}/`,
      '/p/ab/',
      `/p/${CODE}/../x/`,
      `https://www.instagram.com/p/${CODE}/`,
    ]) {
      expect(isPopUpPath(bad)).toBe(false);
    }
  });
});
