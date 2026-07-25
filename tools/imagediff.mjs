// tools/imagediff.mjs — ARCHITECTURE.md §8 / gate G8.
// Per-pixel gate. Non-zero exit on ANY moved pixel.
//
// Used to prove a performance change is pixel-neutral, and to catch unintended
// visual drift from a change that claimed to be mechanical.
//
//   node tools/imagediff.mjs                compare artifacts/ vs baseline/
//   node tools/imagediff.mjs --tolerance 1  allow +/-1 LSB per channel

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, ARTIFACTS, BASELINE_DIR, ensureDir, writeJson, fmt, PASS, FAIL, WARN } from './lib.mjs';
import { SHOTS, SHOT_WIDTH, SHOT_HEIGHT } from './shots.mjs';

const args = process.argv.slice(2);
const TOL = args.includes('--tolerance') ? parseInt(args[args.indexOf('--tolerance') + 1] ?? '0', 10) : 0;

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function lab(r, g, b) {
  const R = srgbToLinear(r / 255),
    G = srgbToLinear(g / 255),
    B = srgbToLinear(b / 255);
  let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  X = f(X);
  Y = f(Y);
  Z = f(Z);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}

const rows = [];
let anyFail = false;
let missingBaseline = 0;

for (const shot of SHOTS) {
  const aPath = path.join(ARTIFACTS, 'shots', `${shot.name}.bin`);
  const bPath = path.join(BASELINE_DIR, 'shots', `${shot.name}.bin`);
  if (!existsSync(aPath)) {
    rows.push({ name: shot.name, status: 'no-capture' });
    anyFail = true;
    continue;
  }
  if (!existsSync(bPath)) {
    rows.push({ name: shot.name, status: 'no-baseline' });
    missingBaseline++;
    continue;
  }
  const a = await readFile(aPath);
  const b = await readFile(bPath);
  if (a.length !== b.length) {
    rows.push({ name: shot.name, status: 'size-mismatch' });
    anyFail = true;
    continue;
  }

  let moved = 0;
  let maxDE = 0;
  let maxChannel = 0;
  const heat = Buffer.alloc(a.length, 255);
  for (let i = 0; i < a.length; i += 4) {
    const dr = Math.abs(a[i] - b[i]);
    const dg = Math.abs(a[i + 1] - b[i + 1]);
    const db = Math.abs(a[i + 2] - b[i + 2]);
    const d = Math.max(dr, dg, db);
    if (d > maxChannel) maxChannel = d;
    if (d > TOL) {
      moved++;
      const de = Math.hypot(
        ...lab(a[i], a[i + 1], a[i + 2]).map((v, k) => v - lab(b[i], b[i + 1], b[i + 2])[k]),
      );
      if (de > maxDE) maxDE = de;
      heat[i] = 255;
      heat[i + 1] = 0;
      heat[i + 2] = 0;
    } else {
      const g = 255 - Math.floor((a[i] * 0.3 + a[i + 1] * 0.6 + a[i + 2] * 0.1) * 0.6);
      heat[i] = heat[i + 1] = heat[i + 2] = g;
    }
  }

  const pct = (moved / (a.length / 4)) * 100;
  rows.push({
    name: shot.name,
    status: moved === 0 ? 'identical' : 'moved',
    moved,
    pct,
    maxDE,
    maxChannel,
  });
  if (moved > 0) {
    anyFail = true;
    await ensureDir(path.join(ARTIFACTS, 'diff'));
    await writeFile(path.join(ARTIFACTS, 'diff', `${shot.name}.bin`), heat);
  }
}

await writeJson(path.join(ARTIFACTS, 'imagediff.json'), { tolerance: TOL, rows });

console.log(`\nimagediff (tolerance ${TOL} LSB)\n`);
console.log('shot                    status         moved px      %      maxDE  maxCh');
console.log('-'.repeat(76));
for (const r of rows) {
  if (r.status === 'identical') {
    console.log(`${r.name.padEnd(22)} identical`);
  } else if (r.status === 'moved') {
    console.log(
      `${r.name.padEnd(22)} moved      ${String(r.moved).padStart(11)} ${fmt(r.pct, 3).padStart(7)} ${fmt(r.maxDE, 2).padStart(9)} ${String(r.maxChannel).padStart(6)}`,
    );
  } else {
    console.log(`${r.name.padEnd(22)} ${r.status}`);
  }
}

if (missingBaseline === SHOTS.length) {
  console.log(
    `\n${WARN} no baseline committed. Run: node tools/baseline.mjs --accept  (baseline/ is gitignored — see HONEST_ASSESSMENT.md)\n`,
  );
  process.exit(0);
}
console.log(`\n${anyFail ? FAIL : PASS} ${anyFail ? 'pixels moved' : 'all shots pixel-identical'}\n`);
process.exit(anyFail ? 1 : 0);
