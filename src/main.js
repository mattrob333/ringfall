// Entry point. ARCHITECTURE.md §3: imports L6 (game) and L1 (core) only.

import { boot } from './game/index.js';

const errEl = document.getElementById('err');
const seen = new Set();

// Pointer lock is denied inside a sandboxed iframe (an embedded preview pane).
// That is an environment limitation, not a fault in the game, so it is reported
// once to the console and never painted over the viewport.
const BENIGN = /pointer lock|pointerlock/i;

function fatal(err) {
  const text = String(err?.stack || err);
  console.error(err);
  window.__ringfall = window.__ringfall || {};
  window.__ringfall.error = text;

  if (BENIGN.test(text)) return;
  // Identical errors thrown every frame must not grow an unbounded wall of text.
  const key = text.slice(0, 200);
  if (seen.has(key)) return;
  seen.add(key);
  if (errEl) {
    errEl.style.display = 'block';
    errEl.textContent += `${text}\n\n`;
  }
}

window.addEventListener('error', (e) => fatal(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => fatal(e.reason));

boot({
  glCanvas: document.getElementById('gl'),
  hudCanvas: document.getElementById('hud'),
  bootEl: document.getElementById('boot'),
}).catch(fatal);
