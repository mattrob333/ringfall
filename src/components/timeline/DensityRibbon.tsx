'use client';

import { useEffect, useMemo, useRef } from 'react';
import { HEAT_CSS_VAR, cn, heatFromScore, readCssVar } from '@/components/ui';
import { HEAT_LEVELS, type HeatLevel } from '@/lib/types';
import { indexForDate, monthTicks, xForColumn, type Geometry } from './geometry';

export interface RibbonDay {
  date: string;
  total: number;
  peak: number;
  count: number;
}

interface RibbonModel {
  /** Aggregate demand per day index. */
  totals: Float32Array;
  /** `HEAT_LEVELS` index of the hottest event on that day. */
  heats: Uint8Array;
  max: number;
  signature: string;
}

export interface DensityRibbonProps {
  days: RibbonDay[];
  geometry: Geometry;
  height: number;
  className?: string;
}

/**
 * The year, as a solid. One column per day for all 426 of them, painted to a
 * single `<canvas>` — 426 DOM nodes behind a control that repaints on every
 * pointer move would be indefensible.
 *
 * Column height is aggregate demand for that day; column colour is the hottest
 * single event on it. The two readings together are the point: a tall pale-blue
 * week is a busy but unremarkable one, a short white-hot spike is one event
 * that matters more than the rest of the month.
 *
 * Heights use a 0.62 power curve. Linear scaling lets one supernova week flatten
 * the other fifty-one into nothing; the curve keeps the quiet weeks legible
 * while the loud ones still dominate.
 */
export function DensityRibbon({
  days,
  geometry,
  height,
  className,
}: DensityRibbonProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cache = useRef<RibbonModel | null>(null);

  // Normalise once, and hold the model's *identity* stable while the values are
  // unchanged. `useHeatByDay()` is free to hand back a fresh array on every
  // render; the canvas must still only repaint when the numbers move — during a
  // drag the parent re-renders sixty times a second.
  const model = useMemo<RibbonModel>(() => {
    const totalDays = geometry.totalDays;
    const totals = new Float32Array(totalDays + 1);
    const heats = new Uint8Array(totalDays + 1);
    let max = 0;
    let hash = 2166136261;

    for (const d of days) {
      const i = indexForDate(geometry, d.date);
      if (i < 0 || i > totalDays) continue;
      totals[i] = d.total;
      heats[i] = HEAT_LEVELS.indexOf(heatFromScore(d.peak));
      if (d.total > max) max = d.total;
      // FNV-1a over the values that actually affect the paint.
      hash = Math.imul(hash ^ (i + 1), 16777619);
      hash = Math.imul(hash ^ Math.round(d.total * 4), 16777619);
      hash = Math.imul(hash ^ Math.round(d.peak), 16777619);
    }
    const next: RibbonModel = {
      totals,
      heats,
      max,
      signature: `${hash}:${totalDays}:${Math.round(max * 4)}`,
    };
    const prev = cache.current;
    if (prev && prev.signature === next.signature) return prev;
    cache.current = next;
    return next;
  }, [days, geometry]);

  const { width, colWidth, totalDays } = geometry;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Colours come from the same custom properties the DOM uses. Nothing here
    // knows a hex value.
    const ramp = HEAT_LEVELS.map((h: HeatLevel) =>
      readCssVar(HEAT_CSS_VAR[h], '#4fa3c7'),
    );
    const inkFaint = readCssVar('--color-ink-faint', '#6b6a63');

    // Month gridlines, behind everything.
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = inkFaint;
    for (const t of monthTicks(geometry)) {
      ctx.fillRect(Math.round(xForColumn(geometry, t.index)), 0, 1, height);
    }

    const { totals, heats, max } = model;
    if (max > 0) {
      const gap = colWidth > 3.2 ? 1 : 0;
      const w = Math.max(0.6, colWidth - gap);
      const usable = height - 1;

      for (let i = 0; i <= totalDays; i += 1) {
        const t = totals[i] ?? 0;
        if (t <= 0) continue;
        const h = Math.max(1.5, Math.pow(t / max, 0.62) * usable);
        const x = xForColumn(geometry, i);
        const y = height - h;
        const colour = ramp[heats[i] ?? 0] ?? ramp[0] ?? '#4fa3c7';

        ctx.fillStyle = colour;
        ctx.globalAlpha = 0.42;
        ctx.fillRect(x, y, w, h);
        // A brighter cap, so the silhouette of the year reads as a drawn line.
        ctx.globalAlpha = 0.95;
        ctx.fillRect(x, y, w, 1);
      }
    }

    // Baseline.
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = inkFaint;
    ctx.fillRect(0, height - 1, width, 1);
    ctx.globalAlpha = 1;
  }, [model, geometry, width, height, colWidth, totalDays]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn('pointer-events-none block', className)}
      style={{ width, height }}
    />
  );
}
