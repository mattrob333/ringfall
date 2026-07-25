// Entry point. ARCHITECTURE.md §3: imports L6 (game) and L1 (core) only.

import { boot } from './game/index.js';

const errEl = document.getElementById('err');
function fatal(err) {
  console.error(err);
  if (errEl) {
    errEl.style.display = 'block';
    errEl.textContent += `${err?.stack || err}\n\n`;
  }
  window.__ringfall = window.__ringfall || {};
  window.__ringfall.error = String(err?.stack || err);
}

window.addEventListener('error', (e) => fatal(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => fatal(e.reason));

boot({
  glCanvas: document.getElementById('gl'),
  hudCanvas: document.getElementById('hud'),
  bootEl: document.getElementById('boot'),
}).catch(fatal);
