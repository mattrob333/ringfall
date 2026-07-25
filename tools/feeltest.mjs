// tools/feeltest.mjs — the most important tool in the repo. ARCHITECTURE.md §8.
//
// Feel is normally graded by opinion. Here it is a failing test.
//
// Runs entirely headless in node: no renderer, no browser, no GPU. That is only
// possible because ARCHITECTURE.md §3 forbids src/physics, src/player,
// src/weapons, src/ai and src/vehicles from importing src/render.
//
// Critic C3 reads THIS OUTPUT and FEEL.md. It may not grade from screenshots.

import path from 'node:path';
import { ARTIFACTS, writeJson, fmt, PASS, FAIL, WARN } from './lib.mjs';

const SUITES = [
  { name: 'physics', mod: '../src/physics/selftest.js', fn: 'runPhysicsSelfTest' },
  { name: 'sandbox', mod: '../src/weapons/selftest.js', fn: 'runSandboxSelfTest' },
  { name: 'ai', mod: '../src/ai/selftest.js', fn: 'runAiSelfTest' },
  { name: 'vehicles', mod: '../src/vehicles/selftest.js', fn: 'runVehicleSelfTest' },
  { name: 'characters', mod: '../src/characters/selftest.js', fn: 'runCharacterSelfTest' },
  { name: 'fx', mod: '../src/fx/selftest.js', fn: 'runFxSelfTest' },
];

const all = [];
const suiteSummary = [];
let hardFail = false;

for (const suite of SUITES) {
  let result = null;
  try {
    const mod = await import(suite.mod);
    const fn = mod[suite.fn] ?? mod.default;
    if (typeof fn !== 'function') {
      suiteSummary.push({ name: suite.name, status: 'missing-export', passed: 0, failed: 0 });
      hardFail = true;
      continue;
    }
    result = await fn();
  } catch (err) {
    suiteSummary.push({
      name: suite.name,
      status: 'threw',
      error: String(err?.message ?? err).slice(0, 300),
      passed: 0,
      failed: 0,
    });
    hardFail = true;
    continue;
  }

  // Suites independently chose three different result shapes:
  //   {passed:number, failed:number, results:[{ok}]}   physics, ai, vehicles, fx
  //   {passed:boolean, failed:[...],  results:[{...}]}  characters
  // Normalise rather than force one owner to rewrite a working suite. Entries
  // WITHOUT an `ok` field are descriptive measurements, not assertions, and
  // must not be counted as failures — that misread showed the passing
  // character suite as "0 pass / 4 fail".
  const raw = result?.results ?? [];
  const assertions = raw.filter((r) => typeof r?.ok === 'boolean');
  const failedList = Array.isArray(result?.failed) ? result.failed : null;

  let passed;
  let failed;
  if (typeof result?.passed === 'number' && typeof result?.failed === 'number') {
    passed = result.passed;
    failed = result.failed;
  } else if (failedList) {
    failed = failedList.length;
    passed = assertions.length ? assertions.filter((r) => r.ok).length : failed === 0 ? 1 : 0;
  } else {
    passed = assertions.filter((r) => r.ok).length;
    failed = assertions.filter((r) => !r.ok).length;
  }
  const results = assertions;
  suiteSummary.push({ name: suite.name, status: 'ran', passed, failed });
  for (const r of results) all.push({ suite: suite.name, ...r });
  if (failed > 0) hardFail = true;
}

// ---------------------------------------------------------------------------
// FEEL.md §8 coverage. An assertion that no suite claims is NOT a silent pass.
// ---------------------------------------------------------------------------
const EXPECTED_IDS = Array.from({ length: 55 }, (_, i) => `F${String(i + 1).padStart(2, '0')}`);
const claimed = new Set(all.map((r) => r.id).filter(Boolean));
const uncovered = EXPECTED_IDS.filter((id) => !claimed.has(id));

await writeJson(path.join(ARTIFACTS, 'feeltest.json'), {
  suites: suiteSummary,
  results: all,
  uncovered,
  passed: all.filter((r) => r.ok).length,
  failed: all.filter((r) => !r.ok).length,
});

console.log('\nfeeltest — FEEL.md §8 assertions, headless\n');
console.log('suite         status          pass  fail');
console.log('-'.repeat(44));
for (const s of suiteSummary) {
  const mark = s.status !== 'ran' ? FAIL : s.failed ? FAIL : PASS;
  console.log(
    `${s.name.padEnd(13)} ${s.status.padEnd(15)} ${String(s.passed).padStart(4)}  ${String(s.failed).padStart(4)} ${mark}`,
  );
  if (s.error) console.log(`   ${s.error}`);
}

const failures = all.filter((r) => !r.ok);
if (failures.length) {
  console.log('\nfailing assertions\n');
  console.log('id    suite      name                                measured        expected');
  console.log('-'.repeat(90));
  for (const r of failures) {
    console.log(
      `${String(r.id ?? '--').padEnd(5)} ${r.suite.padEnd(10)} ${String(r.name ?? '').slice(0, 34).padEnd(35)} ${String(r.measured ?? '').slice(0, 14).padEnd(15)} ${String(r.expected ?? '')}`,
    );
  }
}

if (uncovered.length) {
  console.log(
    `\n${WARN} ${uncovered.length}/55 FEEL.md assertions are NOT covered by any suite: ${uncovered.join(' ')}`,
  );
  console.log('   An uncovered assertion is an untested claim, not a pass.');
}

const total = all.length;
const passCount = all.filter((r) => r.ok).length;
console.log(
  `\n${hardFail ? FAIL : PASS} ${passCount}/${total} assertions pass across ${suiteSummary.length} suites\n`,
);
process.exit(hardFail ? 1 : 0);
