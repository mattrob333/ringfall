/**
 * MERIDIAN — alerts public surface.
 *
 * Three layers, deliberately re-exported together so a consumer never has to
 * know which file a symbol lives in:
 *
 *   • `leadTimes`  — the calibrated per-category lead times, the one-line
 *                    justification for each, and `leadDaysFor()`. Read the file
 *                    header before using the numbers for anything: it is very
 *                    specific about what they are not.
 *   • `engine`     — pure, dependency-free band maths and copy. Safe in a route
 *                    handler, a client component, or a plain node script.
 *   • `useAlerts`  — the React projections, memoised on the day string.
 *
 * The hooks are `'use client'`. That makes this barrel a client boundary when
 * it is pulled into a Server Component, which is harmless — but a node script
 * or a route handler that only wants the arithmetic should import
 * `@/lib/alerts/engine` directly and skip React entirely.
 */

export * from './leadTimes';
export * from './engine';
export * from './useAlerts';
