// tools/playtest.mjs — scripted movement and combat smoke test in a real browser.
// ARCHITECTURE.md §8 / gate G5. Catches integration failures that headless
// feeltest cannot see: shader link errors, NaN transforms, event storms, leaks.

import path from 'node:path';
import {
  ARTIFACTS,
  URL_BASE,
  startServer,
  launchBrowser,
  openFreshPage,
  writeJson,
  fmt,
  PASS,
  FAIL,
} from './lib.mjs';

const DURATION_S = 60;

const stop = await startServer();
const browser = await launchBrowser();
let exitCode = 0;
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  if (!ok) exitCode = 1;
};

try {
  const { context, page, consoleErrors } = await openFreshPage(browser, {
    width: 1280,
    height: 720,
    url: `${URL_BASE}/?det=1&seed=4242`,
  });

  check('boots and reaches ready', true);

  const initial = await page.evaluate(() => ({
    enemies: window.__ringfall.ai.agents.length,
    meshes: window.__ringfall.level.meshCount,
    statics: window.__ringfall.physics?.staticCount ?? -1,
  }));
  check('level built geometry', initial.meshes > 20, `${initial.meshes} meshes`);
  check('enemies spawned', initial.enemies > 0, `${initial.enemies} agents`);

  // Drive real input through the same InputState the player uses.
  const trace = await page.evaluate(async (durationS) => {
    const rf = window.__ringfall;
    const steps = Math.round(durationS * 60);
    const bus = rf.events;
    const counts = {};
    const names = [
      'weapon.fired', 'damage.applied', 'entity.killed', 'shield.broken',
      'grenade.thrown', 'grenade.detonated', 'melee.landed', 'surface.impact',
      'ai.alerted', 'ai.leaderKilled', 'ai.panic.start', 'player.jumped', 'player.landed',
    ];
    const unsubs = names.map((n) => bus.on(n, () => { counts[n] = (counts[n] || 0) + 1; }));

    const input = rf.player ? rf._input : null;
    let nan = false;
    let maxPos = 0;

    for (let i = 0; i < steps; i++) {
      const t = i / 60;
      const st = rf.driveInput;
      if (st) {
        st.moveZ = Math.sin(t * 0.5) > -0.3 ? 1 : -1;
        st.moveX = Math.sin(t * 0.37);
        st.lookYaw = Math.sin(t * 0.6) * 0.03;
        st.lookPitch = Math.sin(t * 0.19) * 0.005;
        st.hasLookInput = true;
        st.fire = t % 3 < 1.6;
        st.firePressed = st.fire;
        st.jump = Math.sin(t * 1.1) > 0.97;
        st.jumpPressed = st.jump;
        st.grenadePressed = Math.abs(t % 9 - 4) < 0.02;
        st.meleePressed = Math.abs(t % 7 - 3) < 0.02;
        st.reloadPressed = Math.abs(t % 11 - 5) < 0.02;
      }
      rf.step(1);
      const p = rf.player.position;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) nan = true;
      maxPos = Math.max(maxPos, Math.abs(p.x), Math.abs(p.y), Math.abs(p.z));
      for (const a of rf.ai.agents) {
        if (!Number.isFinite(a.position.x) || !Number.isFinite(a.position.y)) nan = true;
      }
    }
    for (const u of unsubs) u();

    return {
      counts,
      nan,
      maxPos,
      playerAlive: rf.player.alive,
      playerPos: [rf.player.position.x, rf.player.position.y, rf.player.position.z],
      aliveEnemies: rf.ai.agents.filter((a) => a.alive).length,
      totalEnemies: rf.ai.agents.length,
      drawCalls: rf.renderer.stats.drawCalls,
      triangles: rf.renderer.stats.triangles,
      compiles: rf.renderer.stats.compilesThisFrame,
    };
  }, DURATION_S);

  check('no NaN in player or agent transforms', !trace.nan);
  check('player stayed inside the world', trace.maxPos < 5000, `max |coord| ${fmt(trace.maxPos, 1)}`);
  check('weapons actually fired', (trace.counts['weapon.fired'] ?? 0) > 50, `${trace.counts['weapon.fired'] ?? 0} shots`);
  check('shots hit geometry', (trace.counts['surface.impact'] ?? 0) > 10, `${trace.counts['surface.impact'] ?? 0} impacts`);
  check('grenades thrown', (trace.counts['grenade.thrown'] ?? 0) > 0, `${trace.counts['grenade.thrown'] ?? 0}`);
  check('AI noticed the player', (trace.counts['ai.alerted'] ?? 0) > 0, `${trace.counts['ai.alerted'] ?? 0} alerts`);
  check('no shader compiles after warmup', trace.compiles === 0, `${trace.compiles}`);
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  await writeJson(path.join(ARTIFACTS, 'playtest.json'), { checks, trace, consoleErrors });

  console.log(`\nplaytest — ${DURATION_S}s scripted, deterministic\n`);
  for (const c of checks) {
    console.log(`  ${c.ok ? PASS : FAIL}  ${c.name.padEnd(42)} ${c.detail}`);
  }
  console.log('\nevent counts');
  for (const [k, v] of Object.entries(trace.counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(24)} ${v}`);
  }
  console.log(
    `\nenemies alive ${trace.aliveEnemies}/${trace.totalEnemies}   player alive ${trace.playerAlive}   draws ${trace.drawCalls}   tris ${trace.triangles}\n`,
  );

  await context.close();
} finally {
  await browser.close();
  await stop();
}
process.exit(exitCode);
