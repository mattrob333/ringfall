// tools/baseline.mjs — deterministic capture. ARCHITECTURE.md §8.
//
// Every shot gets a FRESH browser context and a FRESH page. This is the single
// most important property of this tool: the prior harness reused one page and
// differed on 10 of 11 shots between two identical runs, which invalidated
// every visual comparison anyone made with it.
//
//   node tools/baseline.mjs              -> capture into artifacts/shots/
//   node tools/baseline.mjs --accept     -> also promote into baseline/shots/
//   node tools/baseline.mjs --verify 3   -> capture N times, require bit-identity

import { writeFile, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  ROOT,
  ARTIFACTS,
  BASELINE_DIR,
  URL_BASE,
  startServer,
  launchBrowser,
  openFreshPage,
  readPixels,
  gpuInfo,
  ensureDir,
  writeJson,
  PASS,
  FAIL,
} from './lib.mjs';
import { SHOTS, SHOT_WIDTH, SHOT_HEIGHT, WARMUP_FRAMES } from './shots.mjs';

const args = process.argv.slice(2);
const ACCEPT = args.includes('--accept');
const VERIFY = args.includes('--verify') ? parseInt(args[args.indexOf('--verify') + 1] ?? '3', 10) : 1;

const outDir = path.join(ARTIFACTS, 'shots');

async function captureRun(browser, runIndex) {
  const results = [];
  for (const shot of SHOTS) {
    const { context, page, consoleErrors } = await openFreshPage(browser, {
      width: SHOT_WIDTH,
      height: SHOT_HEIGHT,
      url: `${URL_BASE}/?det=1&seed=1337&shot=${encodeURIComponent(shot.name)}`,
    });

    await page.evaluate(
      ([pos, yaw, pitch]) => window.__ringfall.setCamera(pos, yaw, pitch),
      [shot.pos, shot.yaw, shot.pitch],
    );

    // Fixed frame budget from a known-clean state. TAA needs its history to
    // converge; 90 frames is well past the 8-phase jitter cycle.
    await page.evaluate((n) => window.__ringfall.step(n), WARMUP_FRAMES);

    const { data, width, height } = await readPixels(page);
    const hash = createHash('sha256').update(data).digest('hex');

    if (runIndex === 0) {
      await ensureDir(outDir);
      await writeFile(path.join(outDir, `${shot.name}.bin`), data);
      const png = await page.screenshot({ type: 'png' });
      await writeFile(path.join(outDir, `${shot.name}.png`), png);
    }

    results.push({ name: shot.name, hash, width, height, consoleErrors });
    await context.close();
  }
  return results;
}

async function main() {
  const stop = await startServer();
  const browser = await launchBrowser();
  let exitCode = 0;

  try {
    const probe = await openFreshPage(browser, { width: 320, height: 200 });
    const gpu = await gpuInfo(probe.page);
    await probe.context.close();
    console.log(`GPU: ${gpu.vendor} / ${gpu.renderer}`);
    if (/swiftshader|llvmpipe|software/i.test(gpu.renderer)) {
      console.log(
        `${FAIL} software rasteriser detected. Capture is still deterministic but profile.mjs numbers would be meaningless.`,
      );
    }

    const runs = [];
    for (let i = 0; i < VERIFY; i++) {
      process.stdout.write(`run ${i + 1}/${VERIFY} `);
      runs.push(await captureRun(browser, i));
      process.stdout.write('done\n');
    }

    const errors = runs[0].flatMap((r) => r.consoleErrors.map((e) => `${r.name}: ${e}`));
    if (errors.length) {
      console.log(`${FAIL} ${errors.length} console error(s):`);
      for (const e of errors.slice(0, 12)) console.log(`   ${e}`);
      exitCode = 1;
    }

    // Bit-identity across runs — the Phase 1 gate.
    let identical = true;
    if (VERIFY > 1) {
      for (let s = 0; s < SHOTS.length; s++) {
        const hashes = runs.map((r) => r[s].hash);
        const same = hashes.every((h) => h === hashes[0]);
        if (!same) {
          identical = false;
          console.log(`${FAIL} ${SHOTS[s].name} differs across runs: ${hashes.map((h) => h.slice(0, 10)).join(' ')}`);
        }
      }
      console.log(
        identical
          ? `${PASS} all ${SHOTS.length} shots bit-identical across ${VERIFY} runs`
          : `${FAIL} capture is NOT deterministic`,
      );
      if (!identical) exitCode = 1;
    }

    await writeJson(path.join(ARTIFACTS, 'baseline.json'), {
      gpu,
      shots: runs[0].map(({ name, hash, width, height }) => ({ name, hash, width, height })),
      verifyRuns: VERIFY,
      deterministic: identical,
    });

    if (ACCEPT && exitCode === 0) {
      await rm(path.join(BASELINE_DIR, 'shots'), { recursive: true, force: true });
      await ensureDir(path.join(BASELINE_DIR, 'shots'));
      await cp(outDir, path.join(BASELINE_DIR, 'shots'), { recursive: true });
      console.log(`${PASS} promoted ${SHOTS.length} shots to baseline/shots/`);
    }
  } finally {
    await browser.close();
    await stop();
  }
  process.exit(exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
