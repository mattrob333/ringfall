/**
 * Bakes Natural Earth vector geometry into static GeoJSON the globe renderer
 * can consume directly. Run once at setup; output is committed.
 *
 *   node scripts/build-geo.mjs
 *
 * Source: world-atlas (Natural Earth, public domain), pulled via npm because
 * the build environment has no CDN egress. Nothing is fetched at runtime.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature, mesh } from 'topojson-client';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'geo');
mkdirSync(outDir, { recursive: true });

const read = (name) =>
  JSON.parse(readFileSync(join(root, 'node_modules', 'world-atlas', name), 'utf8'));

/** Round coordinates to shave bytes — 3dp is ~110m at the equator, far below
 *  what a 1024px-wide globe can resolve. */
const round = (geo, dp = 3) => {
  const f = 10 ** dp;
  const walk = (c) =>
    typeof c[0] === 'number'
      ? [Math.round(c[0] * f) / f, Math.round(c[1] * f) / f]
      : c.map(walk);
  const visit = (g) => {
    if (g.coordinates) g.coordinates = walk(g.coordinates);
    if (g.geometries) g.geometries.forEach(visit);
    if (g.features) g.features.forEach((ft) => visit(ft.geometry));
    return g;
  };
  return visit(geo);
};

const write = (name, data) => {
  const json = JSON.stringify(data);
  writeFileSync(join(outDir, name), json);
  console.log(`  ${name.padEnd(28)} ${(json.length / 1024).toFixed(0)} kB`);
};

console.log('Baking globe geometry…');

// Country polygons at two detail levels. 110m for the far view, 50m once the
// camera is close enough that 110m's simplification becomes visible.
for (const [src, out] of [
  ['countries-110m.json', 'countries-110m.geo.json'],
  ['countries-50m.json', 'countries-50m.geo.json'],
]) {
  const topo = read(src);
  write(out, round(feature(topo, topo.objects.countries)));
}

// Interior borders only (shared edges drawn once, not twice) — this is what
// makes the country lines read as hairlines rather than doubled strokes.
{
  const topo = read('countries-110m.json');
  write(
    'borders-110m.geo.json',
    round(mesh(topo, topo.objects.countries, (a, b) => a !== b)),
  );
  write(
    'coastline-110m.geo.json',
    round(mesh(topo, topo.objects.land, (a, b) => a === b)),
  );
}

// Graticule: 15° meridians and parallels, generated rather than stored.
{
  const step = 15;
  const lines = [];
  for (let lon = -180; lon <= 180; lon += step) {
    const pts = [];
    for (let lat = -90; lat <= 90; lat += 2) pts.push([lon, lat]);
    lines.push(pts);
  }
  for (let lat = -75; lat <= 75; lat += step) {
    const pts = [];
    for (let lon = -180; lon <= 180; lon += 2) pts.push([lon, lat]);
    lines.push(pts);
  }
  write('graticule.geo.json', { type: 'MultiLineString', coordinates: lines });
}

console.log('Done.');
