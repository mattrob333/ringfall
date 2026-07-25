// tools/ — shared harness helpers. OWNER: orchestrator.
// ARCHITECTURE.md §8. Tools may not be edited to make a failing gate pass.

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
export const ARTIFACTS = path.join(ROOT, 'artifacts');
export const BASELINE_DIR = path.join(ROOT, 'baseline');
export const PORT = 5178;
export const URL_BASE = `http://127.0.0.1:${PORT}`;

/** Start a vite dev server on an isolated port. Returns a kill function. */
export async function startServer({ silent = true } = {}) {
  const child = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: silent ? 'ignore' : 'inherit', shell: process.platform === 'win32' },
  );
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(URL_BASE, { method: 'GET' });
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  return async () => {
    child.kill('SIGTERM');
    await sleep(200);
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Launch Chromium with a real GPU path. SwiftShader would give us numbers that
 * mean nothing for tools/profile.mjs, so we ask for hardware and report what we
 * actually got rather than silently accepting a software rasteriser.
 */
export async function launchBrowser({ headless = true } = {}) {
  return chromium.launch({
    headless,
    args: [
      '--use-angle=default',
      '--enable-unsafe-webgpu',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--disable-frame-rate-limit',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--hide-scrollbars',
      '--mute-audio',
    ],
  });
}

/**
 * ARCHITECTURE.md §7.5: a FRESH browser context and a FRESH page for every
 * shot. Shared-page capture leaks particle age, decal buffers and temporal
 * history forward; the prior harness differed on 10 of 11 shots between two
 * identical runs and every comparison made with it was worthless.
 */
export async function openFreshPage(browser, { width, height, url, seed = 1337 }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto(url ?? `${URL_BASE}/?det=1&seed=${seed}`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction('window.__ringfall && window.__ringfall.ready === true', null, {
    timeout: 45000,
  });
  return { context, page, consoleErrors };
}

export async function gpuInfo(page) {
  return page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return { renderer: 'none', vendor: 'none' };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    };
  });
}

/**
 * Read the raw drawing buffer as RGBA bytes. We compare .bin, not .png:
 * PNG encoders are free to vary and would give us false diffs.
 */
/**
 * Read the raw drawing buffer as RGBA bytes. We compare .bin, not .png:
 * PNG encoders are free to vary and would give us false diffs.
 *
 * The readback MUST happen in the same synchronous task as the render, which is
 * why this defers to __ringfall.capture() in the page rather than reaching for
 * the canvas itself. See src/game/index.js for the measurement that forced it.
 */
export async function readPixels(page) {
  const b64 = await page.evaluate(() => window.__ringfall.capture());
  return { data: Buffer.from(b64.data, 'base64'), width: b64.width, height: b64.height };
}

export async function ensureDir(p) {
  if (!existsSync(p)) await mkdir(p, { recursive: true });
}

export async function writeJson(file, obj) {
  await ensureDir(path.dirname(file));
  await writeFile(file, JSON.stringify(obj, null, 2));
}

export function fmt(n, d = 2) {
  return Number.isFinite(n) ? n.toFixed(d) : String(n);
}

export function pct(a, b) {
  return b === 0 ? 0 : (a / b) * 100;
}

/** Percentile from an unsorted array. */
export function percentile(arr, p) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[i];
}

export const PASS = '\x1b[32mPASS\x1b[0m';
export const FAIL = '\x1b[31mFAIL\x1b[0m';
export const WARN = '\x1b[33mWARN\x1b[0m';
