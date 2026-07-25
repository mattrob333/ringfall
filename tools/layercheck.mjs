// tools/layercheck.mjs — ARCHITECTURE.md §3 import lattice + §7 determinism bans.
// A module may import from STRICTLY LOWER layers and from its own directory only.

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, PASS, FAIL, WARN } from './lib.mjs';

const LAYER = {
  shared: 0,
  core: 1,
  render: 2,
  materials: 3,
  physics: 3,
  audio: 3,
  world: 4,
  characters: 4,
  fx: 4,
  ui: 4,
  player: 5,
  weapons: 5,
  ai: 5,
  vehicles: 5,
  game: 6,
};

// Explicit exceptions, each justified. Anything not listed here is a violation.
const EXCEPTIONS = [
  // physics and audio must stay renderer-free so feeltest can run headless.
  { from: 'physics', forbid: 'render', reason: 'headless requirement' },
  { from: 'audio', forbid: 'render', reason: 'headless requirement' },
];

// ARCHITECTURE.md §7.2: engine clock and seeded RNG only.
const BANNED = [
  { re: /\bMath\.random\s*\(/, msg: 'Math.random() — use rng() from core/rng.js' },
  { re: /\bDate\.now\s*\(/, msg: 'Date.now() — use the engine clock' },
  { re: /\bperformance\.now\s*\(/, msg: 'performance.now() — use the engine clock' },
  { re: /\bnew\s+Date\s*\(\s*\)/, msg: 'new Date() — use the engine clock' },
];
const CLOCK_EXEMPT = new Set([
  path.join('src', 'core', 'clock.js'),
  path.join('src', 'core', 'rng.js'),
]);

/**
 * Strip comments before scanning.
 *
 * Without this the banned-call check matches its own documentation: three
 * subsystems were flagged for `Math.random()` / `Date.now()` purely because
 * their headers contain a comment promising NOT to use them. A tool that
 * reports a violation for a comment is a broken tool, and the fix belongs here
 * rather than in the subsystems' comments.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

async function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = await walk(path.join(ROOT, 'src'));
const violations = [];
const warnings = [];

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

for (const file of files) {
  const rel = path.relative(ROOT, file);
  const parts = rel.split(path.sep);
  if (parts[0] !== 'src' || parts.length < 3) continue; // src/main.js handled below
  const subsystem = parts[1];
  const myLayer = LAYER[subsystem];
  if (myLayer === undefined) {
    warnings.push(`unknown subsystem directory: src/${subsystem}`);
    continue;
  }

  const raw = await readFile(file, 'utf8');
  const text = stripComments(raw);

  if (!CLOCK_EXEMPT.has(rel)) {
    for (const { re, msg } of BANNED) {
      if (re.test(text)) violations.push(`${rel}: ${msg}`);
    }
  }

  const specs = [];
  for (const m of text.matchAll(IMPORT_RE)) specs.push(m[1]);
  for (const m of text.matchAll(DYNAMIC_RE)) specs.push(m[1]);

  for (const spec of specs) {
    if (!spec.startsWith('.')) continue; // bare specifier: three, etc.
    const abs = path.resolve(path.dirname(file), spec);
    const target = path.relative(ROOT, abs).split(path.sep);
    if (target[0] !== 'src' || target.length < 2) continue;
    const targetSubsystem = target[1];
    if (targetSubsystem === subsystem) continue; // own directory is always fine

    const targetLayer = LAYER[targetSubsystem];
    if (targetLayer === undefined) continue;

    if (targetLayer >= myLayer) {
      violations.push(
        `${rel} (L${myLayer} ${subsystem}) imports src/${targetSubsystem} (L${targetLayer}) — upward or sideways import`,
      );
    }
    for (const ex of EXCEPTIONS) {
      if (subsystem === ex.from && targetSubsystem === ex.forbid) {
        violations.push(`${rel}: src/${ex.from} must never import src/${ex.forbid} (${ex.reason})`);
      }
    }
  }
}

// src/main.js may import game and core only.
const mainPath = path.join(ROOT, 'src', 'main.js');
if (existsSync(mainPath)) {
  const text = stripComments(await readFile(mainPath, 'utf8'));
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    const target = path.relative(ROOT, path.resolve(path.dirname(mainPath), spec)).split(path.sep);
    if (target[1] && !['game', 'core'].includes(target[1])) {
      violations.push(`src/main.js imports src/${target[1]} — entry may import game and core only`);
    }
  }
}

for (const w of warnings) console.log(`${WARN} ${w}`);

if (violations.length) {
  console.log(`${FAIL} layercheck: ${violations.length} violation(s)`);
  for (const v of violations) console.log(`   ${v}`);
  process.exit(1);
}
console.log(`${PASS} layercheck: ${files.length} files, import lattice and determinism bans clean`);
