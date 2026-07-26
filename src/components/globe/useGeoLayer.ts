'use client';

/**
 * Loader for the baked Natural Earth layers in `/public/geo`.
 *
 * Two module-level caches sit behind this: one for in-flight requests, one for
 * parsed results. Between them, a React StrictMode double-mount, a fast
 * refresh, or three components asking for the same layer all resolve to the
 * *same object identity* — which matters more than the network saving, because
 * `buildLandGeometry` keys its geometry cache on that identity.
 */

import { useEffect, useState } from 'react';
import type { GeoSource } from '@/lib/geo/geojson';

export const GEO_LAYERS = {
  countries110m: '/geo/countries-110m.geo.json',
  countries50m: '/geo/countries-50m.geo.json',
  borders110m: '/geo/borders-110m.geo.json',
  coastline110m: '/geo/coastline-110m.geo.json',
  graticule: '/geo/graticule.geo.json',
} as const;

export type GeoLayerUrl = (typeof GEO_LAYERS)[keyof typeof GEO_LAYERS];

const parsed = new Map<string, GeoSource>();
const inflight = new Map<string, Promise<GeoSource>>();
const failed = new Set<string>();

/** Fetch + parse a layer, deduplicated across every caller. */
export function loadGeoLayer(url: string): Promise<GeoSource> {
  const hit = parsed.get(url);
  if (hit) return Promise.resolve(hit);

  const pending = inflight.get(url);
  if (pending) return pending;

  const promise = fetch(url, { cache: 'force-cache' })
    .then((res) => {
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      return res.json() as Promise<GeoSource>;
    })
    .then((json) => {
      parsed.set(url, json);
      inflight.delete(url);
      return json;
    })
    .catch((err: unknown) => {
      inflight.delete(url);
      failed.add(url);
      throw err;
    });

  inflight.set(url, promise);
  return promise;
}

/** Already-resolved layer, if any. Lets the first paint skip a frame of null. */
export function peekGeoLayer(url: string): GeoSource | null {
  return parsed.get(url) ?? null;
}

/**
 * Subscribe to a layer. Returns `null` until it lands; pass `null` for `url` to
 * opt out entirely (used for the 50m set, which only loads when the camera is
 * close enough to justify 1.6MB).
 */
export function useGeoLayer(url: string | null): GeoSource | null {
  const [data, setData] = useState<GeoSource | null>(() =>
    url ? peekGeoLayer(url) : null,
  );

  useEffect(() => {
    if (!url) {
      setData(null);
      return;
    }

    const immediate = peekGeoLayer(url);
    if (immediate) {
      setData(immediate);
      return;
    }
    if (failed.has(url)) return;

    let live = true;
    loadGeoLayer(url)
      .then((json) => {
        if (live) setData(json);
      })
      .catch(() => {
        /* A missing decoration is not worth a broken globe. */
      });

    return () => {
      live = false;
    };
  }, [url]);

  return data;
}
