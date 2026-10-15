/**
 * Packs dist/ into release/dwell-<version>.zip and writes release/dwell-<version>.sha256.txt with one
 * SHA-256 per file inside the zip, in `sha256sum` format, so an installed build can be checked file by
 * file with `sha256sum -c` (the Web Store repackages the zip, so a hash of the zip itself would not match).
 *
 * The zip is written here, with no dependency and no system binary: STORED entries (no compression),
 * names sorted, every timestamp set to 1980-01-01 00:00, so the same dist/ always gives the same bytes.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';

export interface ZipInput {
  /** Path inside the zip, forward slashes, no leading slash. */
  name: string;
  data: Uint8Array;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
const VERSION = 20;
/** Bit 11: names are UTF-8. */
const FLAGS = 0x0800;
const STORED = 0;
/** MS-DOS time 00:00:00 and date 1980-01-01. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
/** Unix regular file, mode 644, made by a Unix host. */
const EXTERNAL_ATTRS = (0o100644 << 16) >>> 0;
const MADE_BY = (3 << 8) | VERSION;
const MAX_U32 = 0xffffffff;
const MAX_ENTRIES = 0xffff;

function header(size: number, write: (view: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(size);
  write(new DataView(bytes.buffer));
  return bytes;
}

/** A store-only zip of `files`, in the order given. Throws past the classic (non-zip64) limits. */
export function storedZip(files: readonly ZipInput[]): Uint8Array {
  if (files.length > MAX_ENTRIES) throw new Error(`zip: ${files.length} files exceed ${MAX_ENTRIES}`);
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const size = file.data.byteLength;
    if (size > MAX_U32 || offset > MAX_U32) throw new Error(`zip: ${file.name} is past the 4 GB limit`);
    const crc = crc32(file.data);

    const local = header(30, (v) => {
      v.setUint32(0, LOCAL_HEADER, true);
      v.setUint16(4, VERSION, true);
      v.setUint16(6, FLAGS, true);
      v.setUint16(8, STORED, true);
      v.setUint16(10, DOS_TIME, true);
      v.setUint16(12, DOS_DATE, true);
      v.setUint32(14, crc, true);
      v.setUint32(18, size, true);
      v.setUint32(22, size, true);
      v.setUint16(26, name.byteLength, true);
      v.setUint16(28, 0, true);
    });
    const entry = header(46, (v) => {
      v.setUint32(0, CENTRAL_HEADER, true);
      v.setUint16(4, MADE_BY, true);
      v.setUint16(6, VERSION, true);
      v.setUint16(8, FLAGS, true);
      v.setUint16(10, STORED, true);
      v.setUint16(12, DOS_TIME, true);
      v.setUint16(14, DOS_DATE, true);
      v.setUint32(16, crc, true);
      v.setUint32(20, size, true);
      v.setUint32(24, size, true);
      v.setUint16(28, name.byteLength, true);
      v.setUint16(30, 0, true);
      v.setUint16(32, 0, true);
      v.setUint16(34, 0, true);
      v.setUint16(36, 0, true);
      v.setUint32(38, EXTERNAL_ATTRS, true);
      v.setUint32(42, offset, true);
    });

    parts.push(local, name, file.data);
    central.push(entry, name);
    offset += local.byteLength + name.byteLength + size;
  }

  const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0);
  if (offset > MAX_U32) throw new Error('zip: archive is past the 4 GB limit');
  const end = header(22, (v) => {
    v.setUint32(0, END_OF_CENTRAL, true);
    v.setUint16(4, 0, true);
    v.setUint16(6, 0, true);
    v.setUint16(8, files.length, true);
    v.setUint16(10, files.length, true);
    v.setUint32(12, centralSize, true);
    v.setUint32(16, offset, true);
    v.setUint16(20, 0, true);
  });
  return Buffer.concat([...parts, ...central, end]);
}

export function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** One `<hex>  <path>` line per file, the format `sha256sum -c` reads. */
export function hashList(files: readonly ZipInput[]): string {
  return files.map((file) => `${sha256(file.data)}  ${file.name}\n`).join('');
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

/** Every file under `dist`, named relative to it with forward slashes, sorted by name. */
export function collect(dist: string): ZipInput[] {
  return walk(dist)
    .map((path) => ({ name: relative(dist, path).split(sep).join('/'), data: readFileSync(path) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function versionOf(path: string): string {
  const manifest: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const version = typeof manifest === 'object' && manifest !== null ? (manifest as { version?: unknown }).version : undefined;
  if (typeof version !== 'string' || !/^\d+(\.\d+){0,3}$/.test(version)) throw new Error(`zip: no valid version in ${path}`);
  return version;
}

function main(): number {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const dist = join(root, 'dist');
  if (!existsSync(join(dist, 'manifest.json'))) {
    console.error('zip: dist/manifest.json not found; run npm run build first.');
    return 1;
  }
  const version = versionOf(join(root, 'manifest.json'));
  const built = versionOf(join(dist, 'manifest.json'));
  if (built !== version) {
    console.error(`zip: dist/ was built from version ${built}, manifest.json says ${version}; rebuild first.`);
    return 1;
  }

  const files = collect(dist);
  const zip = storedZip(files);
  const release = join(root, 'release');
  mkdirSync(release, { recursive: true });
  const zipPath = join(release, `dwell-${version}.zip`);
  const listPath = join(release, `dwell-${version}.sha256.txt`);
  writeFileSync(zipPath, zip);
  writeFileSync(listPath, hashList(files));

  console.log(`zip: ${relative(root, zipPath)} (${files.length} files, ${zip.byteLength} bytes)`);
  console.log(`zip: sha256 ${sha256(zip)}`);
  console.log(`zip: ${relative(root, listPath)} (one SHA-256 per file inside the zip)`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main();
}
