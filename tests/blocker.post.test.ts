import { describe, expect, it } from 'vitest';
import { MIN_OTHER_POSTS, isOtherPostLink, singlePostCode } from '../src/blocker/post.ts';

const CODE = 'DeewiSPpCrm';
const IG = 'https://www.instagram.com';

describe('singlePostCode: the post a single-post page shows', () => {
  it.each([
    [`/p/${CODE}/`, CODE],
    [`/p/${CODE}`, CODE],
    [`/reel/${CODE}/`, CODE],
    [`/someuser/p/${CODE}/`, CODE],
    [`/some.user_1/reel/${CODE}`, CODE],
    ['/P/C0abc/', 'C0abc'],
    ['/Reel/a-b_c/', 'a-b_c'],
  ])('reads %s as the post %s', (path, code) => {
    expect(singlePostCode(path)).toBe(code);
  });

  it.each([
    '/',
    '/someuser/',
    '/p/',
    '/p/abcd/',
    '/p/ab.cde/',
    `/p/${CODE}/liked_by/`,
    `/reels/${CODE}/`,
    `/a/b/p/${CODE}/`,
    '/explore/',
    '/direct/inbox/',
    `p/${CODE}/`,
  ])('finds no single post in %s', (path) => {
    expect(singlePostCode(path)).toBeNull();
  });
});

describe('isOtherPostLink: a link to a post other than the one on screen', () => {
  it.each([
    `${IG}/p/C0abcDEF/`,
    `${IG}/p/C0abcDEF`,
    `${IG}/reel/C0abcDEF/`,
    `${IG}/reels/C0abcDEF/`,
    `${IG}/someuser/p/C0abcDEF/`,
    `${IG}/p/C0abcDEF/?img_index=1`,
    `https://instagram.com/p/C0abcDEF/`,
    `${IG}/p/${CODE.toLowerCase()}/`,
  ])('counts %s', (url) => {
    expect(isOtherPostLink(url, CODE)).toBe(true);
  });

  it.each([
    `${IG}/p/${CODE}/`,
    `${IG}/reel/${CODE}/?igsh=x`,
    `${IG}/someuser/p/${CODE}/`,
    `${IG}/someuser/`,
    `${IG}/p/C0abcDEF/liked_by/`,
    `${IG}/p/abcd/`,
    `${IG}/explore/tags/cats/`,
    'https://evil.example/p/C0abcDEF/',
    'http://www.instagram.com/p/C0abcDEF/',
    '/p/C0abcDEF/',
    'not a url',
    '',
  ])('does not count %s', (url) => {
    expect(isOtherPostLink(url, CODE)).toBe(false);
  });

  it('needs at least 3 such links before anything is hidden', () => {
    expect(MIN_OTHER_POSTS).toBe(3);
  });
});
