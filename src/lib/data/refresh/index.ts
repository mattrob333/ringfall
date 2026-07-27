/**
 * MERIDIAN — the refresh layer.
 *
 * Two halves of one decision: **stop polling everything on one clock, and stop
 * buying a number we can compute.**
 *
 *  • `schedule.ts` — proximity-tiered cadence. Three tiers (`identity`,
 *    `schedule`, `demand`) on three clocks, with the demand clock keyed on the
 *    distance to an event's *next decision point* — its `bookingLeadDays`
 *    cut-off while that is still ahead, its start date afterwards. Takes the
 *    naive 34,704 calls/day over the shipped calendar down to about a thousand.
 *
 *  • `snapshots.ts` — local-first signal history, and `socialVelocity` computed
 *    from it rather than purchased. Cheaper (it rides a fetch we already make),
 *    more accurate (our window, our series), and the only asset here that
 *    compounds: a competitor can buy the same vendor feed tomorrow, but not our
 *    record of what it said last month.
 *
 * They are two halves because they need each other. Computed velocity is only
 * as good as the sampling cadence underneath it — `computeVelocity` needs two
 * samples at least {@link VELOCITY_MIN_GAP_DAYS} apart, which is exactly what
 * the demand tier's 48h/24h/6h bands guarantee inside six months of an event.
 * And the scheduler is only worth building because there is something worth
 * storing at the other end of it.
 *
 * ── Import surface ───────────────────────────────────────────────────────────
 *
 * Both modules are isomorphic. Neither reads `process.env`, neither imports the
 * server-only source registry, and `snapshots.ts` resolves `localStorage`
 * lazily inside calls — so a client component can render a cadence table or a
 * velocity sparkline, and a route handler or a plain node script can plan a
 * sweep, from the same import.
 */

export type {
  RefreshTier,
  RefreshPolicy,
  RefreshHorizon,
  LastSyncedByTier,
  SweepPlan,
  CadenceRow,
  CostComparison,
} from './schedule';

export {
  REFRESH_TIERS,
  IDENTITY_INTERVAL_HOURS,
  SCHEDULE_INTERVAL_HOURS,
  DEMAND_FAR_INTERVAL_HOURS,
  DEMAND_APPROACH_INTERVAL_HOURS,
  DEMAND_WINDOW_INTERVAL_HOURS,
  DEMAND_IMMINENT_INTERVAL_HOURS,
  DEMAND_FAR_DAYS,
  DEMAND_WINDOW_END_DAYS,
  DEMAND_WINDOW_START_DAYS,
  ADAPTERS_PER_TIER,
  NAIVE_ADAPTER_COUNT,
  NAIVE_SWEEPS_PER_DAY,
  NAIVE_CALLS_PER_EVENT_PER_DAY,
  horizonFor,
  demandIntervalFor,
  policyFor,
  dueNow,
  planSweep,
  cadenceSummary,
  costComparison,
} from './schedule';

export type {
  SignalSnapshot,
  SnapshotRow,
  SnapshotArchive,
  SnapshotStore,
  SnapshotStats,
} from './snapshots';

export {
  MAX_STORED_CHARS,
  RETENTION_DAYS,
  MAX_ROWS_PER_EVENT,
  SIGNAL_ORDER,
  ARCHIVE_VERSION,
  STORAGE_KEY,
  VELOCITY_WINDOW_DAYS,
  VELOCITY_MIN_GAP_DAYS,
  VELOCITY_MAX_GAP_DAYS,
  localStorageSnapshotStore,
  setSnapshotStore,
  recordSnapshot,
  recordSnapshots,
  historyFor,
  computeVelocity,
  pruneHistory,
  clearHistory,
  snapshotStats,
} from './snapshots';
