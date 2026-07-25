import { runCharacterSelfTest, formatSelfTest, maskToAscii } from './src/characters/selftest.js';
const res = runCharacterSelfTest({ ascii: process.argv.includes('--ascii') });
console.log(formatSelfTest(res));
if (process.argv.includes('--ascii')) {
  for (const r of res.results) { console.log('\n=== ' + r.archetype + ' ==='); console.log(r.ascii); }
}
