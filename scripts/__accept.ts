import { EVENTS } from '@/lib/data/events';
import { scoreEvents, scoreEvent } from '@/lib/buzz/scoring';
import { computeRelevance } from '@/lib/buzz/relevance';
import { todayISO, daysBetween } from '@/lib/buzz/dates';

const MARQUEE = ['Monaco Grand Prix','The Championships, Wimbledon','Royal Ascot','Festival de Cannes',
  '24 Hours of Le Mans','Art Basel','The Masters Tournament','Kentucky Derby','The Met Gala',
  'Monaco Yacht Show','Art Basel Miami Beach','Oktoberfest','Coachella Valley','Carnaval do Rio',
  '99th Academy Awards','Aspen Christmas','Wimbledon','Salzburger Festspiele','Burning Man'];

console.log('ACCEPTANCE: scrub to each marquee week, what does the globe show?\n');
console.log('  heat@focus   score  relev  event');
let ok = 0, total = 0;
for (const m of MARQUEE) {
  const e = EVENTS.find(x => x.name.includes(m));
  if (!e) continue;
  total++;
  const focus = e.start;
  const s = scoreEvents(EVENTS, { now: focus }).find(x => x.eventId === e.id)!;
  const rel = computeRelevance(e, focus, 10);
  const good = s.heat === 'blazing' || s.heat === 'supernova';
  if (good) ok++;
  console.log(`  ${good?'\x1b[32m✓\x1b[0m':'\x1b[33m·\x1b[0m'} ${s.heat.padEnd(11)} ${s.score.toFixed(1).padStart(5)}  ${rel.toFixed(2)}  ${e.name} (rank ${s.rank})`);
}
console.log(`\n  ${ok}/${total} marquee weeks are blazing-or-hotter when you scrub to them.`);

// Monaco specifically, walking the scrubber toward it
const monaco = EVENTS.find(e => e.name === 'Monaco Grand Prix')!;
console.log(`\nMonaco Grand Prix (${monaco.start} → ${monaco.end}) as the scrubber approaches:`);
const today = todayISO();
for (const d of [0, 100, 200, 260, 290, 303, 310, 313]) {
  const focus = new Date(Date.parse(today+'T00:00:00Z') + d*86400000).toISOString().slice(0,10);
  const s = scoreEvent(monaco, { now: focus });
  const rel = computeRelevance(monaco, focus, 10);
  console.log(`  focus +${String(d).padStart(3)}d (${focus})  score ${s.score.toFixed(1).padStart(5)}  ${s.heat.padEnd(11)} relevance ${rel.toFixed(2)}`);
}
