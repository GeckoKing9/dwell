import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifestProblems } from './manifest-rules.ts';

export const BANNED_TOKENS = [
  'fetch(',
  'XMLHttpRequest',
  'WebSocket',
  'sendBeacon',
  'importScripts(',
  'eval(',
  'new Function',
  'new Image',
  'EventSource',
  'WebTransport',
  'RTCPeerConnection',
  'import(',
  'window.open',
] as const;

const SCANNED = new Set(['.js', '.mjs', '.html', '.css']);

export interface Hit {
  file: string;
  line: number;
  token: string;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return SCANNED.has(extname(entry.name)) ? [path] : [];
  });
}

export function scanText(file: string, text: string): Hit[] {
  const hits: Hit[] = [];
  text.split('\n').forEach((content, index) => {
    for (const token of BANNED_TOKENS) {
      if (content.includes(token)) hits.push({ file, line: index + 1, token });
    }
  });
  return hits;
}

export function scanDist(dist: string): Hit[] {
  return walk(dist).flatMap((path) => scanText(relative(dist, path), readFileSync(path, 'utf8')));
}

function main(): number {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const dist = join(root, 'dist');
  if (!existsSync(join(dist, 'manifest.json'))) {
    console.error('check:privacy: dist/manifest.json not found; run npm run build first.');
    return 1;
  }

  const hits = scanDist(dist);
  for (const hit of hits) console.error(`dist/${hit.file}:${hit.line}: banned token ${hit.token}`);

  const manifest: unknown = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
  const problems = manifestProblems(manifest);
  for (const problem of problems) console.error(`dist/manifest.json: ${problem}`);

  const scanned = walk(dist).length;
  if (hits.length > 0 || problems.length > 0) {
    console.error(`check:privacy failed: ${hits.length} banned token(s), ${problems.length} manifest problem(s).`);
    return 1;
  }
  console.log(`check:privacy passed: ${scanned} files scanned, manifest matches the declared list.`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main();
}
