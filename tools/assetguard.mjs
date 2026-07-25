// tools/assetguard.mjs — ARCHITECTURE.md §1. Everything is generated from code.
// Non-zero exit on any binary asset in the source tree or the built bundle.

import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, PASS, FAIL } from './lib.mjs';

const ALLOWED = new Set(['.js', '.mjs', '.glsl', '.json', '.html', '.css', '.md', '.map']);
const SCAN_DIRS = ['src', 'public'];
const BUNDLE_DIRS = ['dist'];
const FORBIDDEN_DATA_URIS = [/data:image\//i, /data:audio\//i, /data:font\//i, /data:video\//i];
const FORBIDDEN_CALLS = [
  { re: /\bnew\s+FontFace\b/, why: 'webfont loading' },
  { re: /@font-face/, why: 'webfont declaration' },
];

async function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

const violations = [];

for (const d of SCAN_DIRS) {
  const files = await walk(path.join(ROOT, d));
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (!ALLOWED.has(ext)) {
      const s = await stat(f);
      violations.push(`binary/unknown asset: ${path.relative(ROOT, f)} (${ext || 'no ext'}, ${s.size} B)`);
      continue;
    }
    if (ext === '.md') continue;
    const text = await readFile(f, 'utf8');
    for (const re of FORBIDDEN_DATA_URIS) {
      if (re.test(text)) violations.push(`embedded data URI (${re}) in ${path.relative(ROOT, f)}`);
    }
    for (const { re, why } of FORBIDDEN_CALLS) {
      if (re.test(text)) violations.push(`${why} in ${path.relative(ROOT, f)}`);
    }
  }
}

for (const d of BUNDLE_DIRS) {
  const files = await walk(path.join(ROOT, d));
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (!ALLOWED.has(ext)) {
      violations.push(`bundled binary asset: ${path.relative(ROOT, f)}`);
      continue;
    }
    if (ext !== '.js' && ext !== '.css' && ext !== '.html') continue;
    const text = await readFile(f, 'utf8');
    for (const re of FORBIDDEN_DATA_URIS) {
      if (re.test(text)) violations.push(`embedded data URI (${re}) in bundle ${path.relative(ROOT, f)}`);
    }
  }
}

if (violations.length) {
  console.log(`${FAIL} assetguard: ${violations.length} violation(s)`);
  for (const v of violations) console.log(`   ${v}`);
  process.exit(1);
}
console.log(`${PASS} assetguard: no binary assets, no embedded data URIs, no webfonts`);
