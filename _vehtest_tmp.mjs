import { runVehicleSelfTest } from './src/vehicles/selftest.js';

const { passed, failed, results } = runVehicleSelfTest();
console.log(`passed=${passed} failed=${failed}`);
for (const r of results) {
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.id} - ${r.name}`);
  console.log(`  measured: ${JSON.stringify(r.measured)}`);
  console.log(`  expected: ${JSON.stringify(r.expected)} tol=${r.tolerance}`);
}
