import { runPhysicsSelfTest } from './src/physics/selftest.js';
const r = runPhysicsSelfTest();
console.log(JSON.stringify(r, null, 2));
console.log(`\n${r.passed} passed, ${r.failed} failed`);
process.exit(r.failed ? 1 : 0);
