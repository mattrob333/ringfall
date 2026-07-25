// tools/profile.mjs — ARCHITECTURE.md §8 / gate G6.
//
// REAL GAMEPLAY. Real device pixel ratio. In motion. AI alive, weapons firing.
// Reports a DISTRIBUTION, never a median alone: the prior harness reported
// 94 fps on a build that ran 12-17 fps in play with 700-1200 ms stalls, because
// it measured a static camera and quoted the median.

import path from 'node:path';
import {
  ARTIFACTS,
  URL_BASE,
  startServer,
  launchBrowser,
  openFreshPage,
  gpuInfo,
  writeJson,
  percentile,
  fmt,
  PASS,
  FAIL,
  WARN,
} from './lib.mjs';

const DURATION_S = 90;
const DPR = 2;
const WIDTH = 1280;
const HEIGHT = 720;

// Gate G6
const GATES = {
  p50Fps: { min: 60, label: 'p50 fps' },
  p99Fps: { min: 45, label: 'p99 fps' },
  worstFrameMs: { max: 50, label: 'worst frame ms' },
  shaderCompilesDuringPlay: { max: 0, label: 'shader compiles during play' },
  bootMs: { max: 4000, label: 'boot ms' },
};

const stop = await startServer();
const browser = await launchBrowser();
let exitCode = 0;

try {
  const { context, page, consoleErrors } = await openFreshPage(browser, {
    width: WIDTH,
    height: HEIGHT,
    url: `${URL_BASE}/?profile=1&dpr=${DPR}`,
  });
  const gpu = await gpuInfo(page);
  console.log(`GPU: ${gpu.vendor} / ${gpu.renderer}`);
  const software = /swiftshader|llvmpipe|software/i.test(gpu.renderer);
  if (software) {
    console.log(`${WARN} software rasteriser — these numbers describe nothing real.`);
  }

  const bootMs = await page.evaluate(() => window.__ringfall?.bootMs ?? -1);

  // Drive real gameplay for the capture window and sample every frame.
  const sample = await page.evaluate(async (durationS) => {
    const rf = window.__ringfall;
    const frames = [];
    const compiles = [];
    let last = -1;
    const startProgram = rf.renderer.stats.programs;

    rf.beginProfile?.();

    await new Promise((resolve) => {
      const t0 = document.timeline.currentTime;
      function loop(now) {
        if (last >= 0) frames.push(now - last);
        last = now;
        compiles.push(rf.renderer.stats.compilesThisFrame | 0);
        if (now - t0 >= durationS * 1000) resolve();
        else requestAnimationFrame(loop);
      }
      requestAnimationFrame(loop);
    });

    rf.endProfile?.();
    return {
      frames,
      compiles,
      programsStart: startProgram,
      programsEnd: rf.renderer.stats.programs,
      drawCalls: rf.renderer.stats.drawCalls,
      triangles: rf.renderer.stats.triangles,
      lights: rf.renderer.clusters.stats().lights,
    };
  }, DURATION_S);

  const f = sample.frames.filter((x) => x > 0 && x < 5000);
  // Discard the first 30 frames: they include first-paint and are not play.
  const play = f.slice(30);
  const compilesDuringPlay = sample.compiles.slice(30).reduce((a, b) => a + b, 0);

  const p50 = percentile(play, 50);
  const p95 = percentile(play, 95);
  const p99 = percentile(play, 99);
  const worst = Math.max(...play);
  const mean = play.reduce((a, b) => a + b, 0) / play.length;

  const measured = {
    frames: play.length,
    meanMs: mean,
    p50Ms: p50,
    p95Ms: p95,
    p99Ms: p99,
    worstFrameMs: worst,
    p50Fps: 1000 / p50,
    p95Fps: 1000 / p95,
    p99Fps: 1000 / p99,
    shaderCompilesDuringPlay: compilesDuringPlay,
    programsStart: sample.programsStart,
    programsEnd: sample.programsEnd,
    bootMs,
    drawCalls: sample.drawCalls,
    triangles: sample.triangles,
    lights: sample.lights,
    dpr: DPR,
    resolution: `${WIDTH}x${HEIGHT}`,
    gpu,
    software,
    consoleErrors: consoleErrors.slice(0, 10),
  };

  // Frame-time histogram so a stall pattern is visible, not averaged away.
  const buckets = [8, 12, 16.7, 20, 25, 33, 50, 100, 250, 1000, Infinity];
  const hist = buckets.map((b, i) => ({
    upTo: b,
    count: play.filter((x) => x <= b && x > (i ? buckets[i - 1] : 0)).length,
  }));
  measured.histogram = hist;

  await writeJson(path.join(ARTIFACTS, 'profile.json'), measured);

  console.log(`\nprofile — ${DURATION_S}s of real gameplay at DPR ${DPR}, ${WIDTH}x${HEIGHT}\n`);
  console.log(`frames sampled     ${measured.frames}`);
  console.log(`mean               ${fmt(mean)} ms   (${fmt(1000 / mean, 1)} fps)`);
  console.log(`p50                ${fmt(p50)} ms   (${fmt(1000 / p50, 1)} fps)`);
  console.log(`p95                ${fmt(p95)} ms   (${fmt(1000 / p95, 1)} fps)`);
  console.log(`p99                ${fmt(p99)} ms   (${fmt(1000 / p99, 1)} fps)`);
  console.log(`worst frame        ${fmt(worst)} ms`);
  console.log(`draw calls         ${measured.drawCalls}`);
  console.log(`triangles          ${measured.triangles}`);
  console.log(`cluster lights     ${measured.lights}`);
  console.log(`programs           ${sample.programsStart} -> ${sample.programsEnd}`);
  console.log(`compiles in play   ${compilesDuringPlay}`);
  console.log(`boot               ${bootMs} ms`);

  console.log('\nframe-time histogram');
  for (const h of hist) {
    if (!h.count) continue;
    const bar = '#'.repeat(Math.min(60, Math.round((h.count / play.length) * 200)));
    console.log(`  <= ${String(h.upTo === Infinity ? 'inf' : h.upTo).padStart(6)} ms  ${String(h.count).padStart(6)}  ${bar}`);
  }

  console.log('\ngate G6');
  const check = (key, v) => {
    const g = GATES[key];
    const ok = g.min !== undefined ? v >= g.min : v <= g.max;
    console.log(
      `  ${g.label.padEnd(30)} ${fmt(v, 1).padStart(9)}  ${g.min !== undefined ? '>= ' + g.min : '<= ' + g.max}  ${ok ? PASS : FAIL}`,
    );
    if (!ok) exitCode = 1;
  };
  check('p50Fps', measured.p50Fps);
  check('p99Fps', measured.p99Fps);
  check('worstFrameMs', measured.worstFrameMs);
  check('shaderCompilesDuringPlay', compilesDuringPlay);
  if (bootMs >= 0) check('bootMs', bootMs);

  if (software) {
    console.log(`\n${WARN} software rasteriser: gate result is NOT meaningful.\n`);
  }
  await context.close();
} finally {
  await browser.close();
  await stop();
}
process.exit(exitCode);
