import { describe, expect, it } from 'vitest';
import { isTrackableUrl, registrableDomain, siteOf } from '../src/tracker/grouping.ts';
import { TWO_LEVEL_SUFFIXES } from '../src/tracker/suffixes.ts';

const OVERRIDES = ['music.youtube.com', 'Docs.Google.com'];

describe('siteOf groups a URL into a site id', () => {
  it.each([
    ['https://www.youtube.com/watch?v=abc', 'youtube.com'],
    ['https://m.youtube.com/shorts/xyz', 'youtube.com'],
    ['https://youtube.com/', 'youtube.com'],
    ['https://music.youtube.com/playlist?list=1', 'music.youtube.com'],
    ['https://docs.google.com/document/d/1/edit', 'docs.google.com'],
    ['https://mail.google.com/mail/u/0/', 'google.com'],
    ['https://www.bbc.co.uk/news', 'bbc.co.uk'],
    ['https://news.bbc.co.uk/', 'bbc.co.uk'],
    ['https://www.abc.net.au/', 'abc.net.au'],
    ['https://www.quebec.qc.ca/', 'quebec.qc.ca'],
    ['https://shop.example.co.jp/', 'example.co.jp'],
    ['http://WWW.Example.COM:8080/Path', 'example.com'],
    ['https://user:secret@sub.example.org/', 'example.org'],
    ['https://example.com./', 'example.com'],
    ['https://www.com/', 'www.com'],
    ['https://co.uk/', 'co.uk'],
    ['http://localhost:5173/', 'localhost'],
    ['http://192.168.0.1/admin', '192.168.0.1'],
    ['http://[::1]:8080/', '[::1]'],
    ['https://xn--bcher-kva.example/', 'xn--bcher-kva.example'],
    ['https://bücher.example/', 'xn--bcher-kva.example'],
    ['https://my_app.example.com/', 'example.com'],
  ])('%s -> %s', (url, site) => {
    expect(siteOf(url, OVERRIDES, [])).toBe(site);
  });

  it('splits an override only when it is named, and matches it with or without www', () => {
    expect(siteOf('https://music.youtube.com/', [], [])).toBe('youtube.com');
    expect(siteOf('https://www.music.youtube.com/', [' music.youtube.com '], [])).toBe('music.youtube.com');
  });

  it.each([
    'chrome://extensions/',
    'chrome://newtab/',
    'chrome://new-tab-page/',
    'chrome-extension://abcdefghijklmnop/popup.html',
    'chrome-untrusted://new-tab-page/',
    'chrome-search://local-ntp/local-ntp.html',
    'about:blank',
    'about:newtab',
    'file:///home/user/notes.txt',
    'blob:https://www.youtube.com/0b7a-11',
    'data:text/html,hello',
    'view-source:https://www.youtube.com/',
    'devtools://devtools/bundled/inspector.html',
    'edge://settings',
    'ftp://ftp.example.com/file',
    'javascript:void(0)',
    'not a url',
    '',
    'https://under_score.example/',
    'https://exa mple.com/',
    'https://exa!mple.com/',
    'https://a..b.example/',
  ])('%s is not trackable', (url) => {
    expect(siteOf(url, OVERRIDES, [])).toBeNull();
    expect(isTrackableUrl(url)).toBe(false);
  });

  it('accepts http and https only', () => {
    expect(isTrackableUrl('https://www.youtube.com/')).toBe(true);
    expect(isTrackableUrl('http://example.com/')).toBe(true);
  });

  it('drops an ignored domain with all its subdomains, and an ignored host alone', () => {
    const ignore = ['YouTube.com', 'mail.google.com'];
    expect(siteOf('https://www.youtube.com/', [], ignore)).toBeNull();
    expect(siteOf('https://music.youtube.com/', OVERRIDES, ignore)).toBeNull();
    expect(siteOf('https://mail.google.com/', [], ignore)).toBeNull();
    expect(siteOf('https://a.mail.google.com/', [], ignore)).toBeNull();
    expect(siteOf('https://docs.google.com/', [], ignore)).toBe('google.com');
    expect(siteOf('https://www.bbc.co.uk/', [], ['co.uk'])).toBe('bbc.co.uk');
  });
});

describe('registrableDomain', () => {
  it('keeps three labels under a bundled two-level suffix and two otherwise', () => {
    expect(registrableDomain('a.b.example.com.br')).toBe('example.com.br');
    expect(registrableDomain('a.b.example.com')).toBe('example.com');
    expect(registrableDomain('example.com')).toBe('example.com');
    expect(registrableDomain('localhost')).toBe('localhost');
    expect(registrableDomain('10.0.0.12')).toBe('10.0.0.12');
  });

  it('bundles about sixty two-level suffixes, all lowercase pairs', () => {
    expect(TWO_LEVEL_SUFFIXES.size).toBeGreaterThanOrEqual(55);
    expect(TWO_LEVEL_SUFFIXES.size).toBeLessThanOrEqual(100);
    for (const suffix of TWO_LEVEL_SUFFIXES) expect(suffix).toMatch(/^[a-z]+\.[a-z]+$/);
    for (const named of ['co.uk', 'com.au', 'qc.ca', 'co.jp', 'com.br', 'co.in', 'org.uk', 'gov.uk', 'ac.uk', 'net.au']) {
      expect(TWO_LEVEL_SUFFIXES.has(named)).toBe(true);
    }
  });
});
