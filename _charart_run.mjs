import { runCharacterSelfTest, formatSelfTest } from './src/characters/selftest.js';
const res = runCharacterSelfTest({ ascii: process.argv.includes('--ascii') });
console.log(formatSelfTest(res));
if (process.argv.includes('--ascii')) {
  const rows = res.results.map(r => r.ascii.split('\n'));
  console.log('\n' + res.results.map(r=>r.archetype.padEnd(50)).join(' '));
  for (let i=0;i<rows[0].length;i++) console.log(rows.map(r=>r[i].padEnd(50)).join(' '));
}
