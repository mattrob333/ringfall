import { runFxSelfTest } from './src/fx/selftest.js';
const t0 = Date.now();
const r = runFxSelfTest({ verbose: false });
const ms = Date.now() - t0;
for (const x of r.results) {
  console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.name}\n        measured=${x.measured}  expected=${x.expected}`);
}
console.log('\nmetrics:', JSON.stringify(r.metrics, null, 2));
console.log(`\npassed=${r.passed} failed=${r.failed}  wall=${ms}ms`);
