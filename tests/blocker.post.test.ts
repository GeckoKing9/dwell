import { describe, expect, it } from 'vitest';
import { isPopUpPath } from '../src/blocker/bridge.ts';
import { DIM_FACTOR, MIN_OTHER_POSTS, popUpPath, POP_UP_EDGE_PX, POP_UP_MARGIN_PX, POP_UP_SIDE_PX, dimColor, isOtherPostLink, leaveBy, popUpBox, singlePostCode } from '../src/blocker/post.ts';

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

describe('popUpBox: the size of a post shown the way Instagram\'s pop-up shows it', () => {
  it('is as tall as the window allows, with the video at its own shape and the comments beside it', () => {
    const box = popUpBox({ width: 1600, height: 960 }, 9 / 16);
    expect(box).not.toBeNull();
    expect(box?.height).toBe(960 - 2 * POP_UP_MARGIN_PX);
    expect(box?.side).toBe(POP_UP_SIDE_PX);
    expect(box?.width).toBe(Math.round((960 - 2 * POP_UP_MARGIN_PX) * (9 / 16)) + POP_UP_SIDE_PX);
  });

  it('gives a landscape video a wider box', () => {
    expect(popUpBox({ width: 2400, height: 960 }, 16 / 9)?.width).toBeGreaterThan(popUpBox({ width: 2400, height: 960 }, 9 / 16)?.width ?? 0);
  });

  it('in a narrower window keeps the video\'s shape and makes the box shorter, never wider than the window less the strip for the close button', () => {
    expect(POP_UP_EDGE_PX).toBe(64);
    const box = popUpBox({ width: 960, height: 1040 }, 16 / 9);
    expect(box?.width).toBe(960 - 2 * POP_UP_EDGE_PX);
    const media = (box?.width ?? 0) - POP_UP_SIDE_PX;
    expect(box?.height).toBe(Math.round(media / (16 / 9)));
  });

  it('is null when the window leaves too little room beside the comments to show the video', () => {
    expect(popUpBox({ width: 640, height: 900 }, 9 / 16)).toBeNull();
    expect(popUpBox({ width: 10, height: 10 }, 9 / 16)).toBeNull();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('reads an unknown shape (%s) as a vertical video', (ratio) => {
    expect(popUpBox({ width: 1600, height: 960 }, ratio)).toEqual(popUpBox({ width: 1600, height: 960 }, 9 / 16));
  });
});

describe('leaveBy: where closing the pop-up goes', () => {
  it('goes back to the Instagram page the post was opened from', () => {
    expect(leaveBy(true, `${IG}/explore/search/keyword/?q=hugo`)).toBe('back');
    expect(leaveBy(true, 'https://instagram.com/')).toBe('back');
  });

  it.each([
    [false, `${IG}/`],
    [true, ''],
    [true, 'https://www.google.com/'],
    [true, 'https://instagram.com.evil.example/'],
    [true, 'not a url'],
  ])('only lifts the pop-up when there is no Instagram page to go back to (%s, %s)', (canGoBack, referrer) => {
    expect(leaveBy(canGoBack, referrer)).toBe('stay');
  });
});

describe('dimColor: the page colour behind the pop-up, dimmed like the parts of the page around it', () => {
  it('dims a light page and a dark page by the same factor as the dimmed elements', () => {
    expect(DIM_FACTOR).toBe(0.35);
    expect(dimColor('rgb(255, 255, 255)')).toBe('rgb(89, 89, 89)');
    expect(dimColor('rgb(0, 0, 0)')).toBe('rgb(0, 0, 0)');
    expect(dimColor('rgba(250, 250, 250, 1)')).toBe('rgb(88, 88, 88)');
    expect(dimColor('rgb(51, 51, 51)')).toBe('rgb(18, 18, 18)');
  });

  it.each(['transparent', 'rgba(0, 0, 0, 0)', '', 'red', 'color(srgb 1 1 1)'])('cannot read %j and says so', (color) => {
    expect(dimColor(color)).toBeNull();
  });
});

describe('popUpPath: the post address a link opens in Instagram\'s pop-up', () => {
  it.each([
    [`${IG}/p/${CODE}/`, `/p/${CODE}/`],
    [`${IG}/p/${CODE}`, `/p/${CODE}/`],
    [`${IG}/reel/${CODE}/`, `/p/${CODE}/`],
    [`${IG}/reels/${CODE}/`, `/p/${CODE}/`],
    [`${IG}/someuser/reel/${CODE}/`, `/p/${CODE}/`],
    [`${IG}/someuser/p/${CODE}/?igsh=x#c`, `/p/${CODE}/`],
    [`https://instagram.com/reel/${CODE}/`, `/p/${CODE}/`],
  ])('opens %s as %s', (url, path) => {
    expect(popUpPath(url)).toBe(path);
  });

  it.each([
    `${IG}/`,
    `${IG}/reels/`,
    `${IG}/someuser/`,
    `${IG}/someuser/reels/`,
    `${IG}/reels/audio/123456/`,
    `${IG}/p/${CODE}/liked_by/`,
    `${IG}/direct/t/123/`,
    `http://www.instagram.com/p/${CODE}/`,
    `https://www.facebook.com/p/${CODE}/`,
    'not a url',
  ])('leaves %s to Instagram', (url) => {
    expect(popUpPath(url)).toBeNull();
  });
});

describe('isPopUpPath: what the page-world bridge accepts', () => {
  it('accepts only a post path in the form popUpPath builds', () => {
    expect(isPopUpPath(`/p/${CODE}/`)).toBe(true);
    for (const bad of [`/p/${CODE}`, `/reel/${CODE}/`, `/p/${CODE}/?x=1`, `//evil.example/p/${CODE}/`, `/p/ab/`, `/p/${CODE}/../x/`, `https://www.instagram.com/p/${CODE}/`]) {
      expect(isPopUpPath(bad)).toBe(false);
    }
  });
});
