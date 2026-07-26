/**
 * MERIDIAN — dataset and buzz-engine validator.
 *
 *   npx tsx scripts/validate-data.ts
 *   npx tsx scripts/validate-data.ts --top 40
 *
 * Exits non-zero on any ERROR. WARNs are printed and do not fail the build —
 * they are things a human should look at (a coordinate 40km from where the city
 * gazetteer thinks the city is) rather than things that are definitely wrong.
 *
 * Three jobs:
 *   1. Structural validation of every WorldEvent against the contract in
 *      types.ts — dates, ranges, required fields, uniqueness, copy limits.
 *   2. Geographic plausibility. Coordinates are the single most error-prone
 *      field in a hand-built dataset and the errors are invisible in review:
 *      a swapped lat/lon looks like a perfectly reasonable pair of numbers and
 *      only shows up as a beacon in the Indian Ocean. Checked against country
 *      bounding boxes plus a city gazetteer.
 *   3. Buzz-engine invariants and distribution — components sum to score, ranks
 *      form 1..n with no gaps, and the heat histogram lands on target.
 */

import {
  EVENT_CATEGORIES,
  HEAT_LEVELS,
  type EventCategory,
  type HeatLevel,
  type WorldEvent,
} from '@/lib/types';
import { EVENTS, EVENT_INDEX } from '@/lib/data/events';
import { SIGNAL_KEYS, assertComponentsSum, scoreEvents } from '@/lib/buzz/scoring';
import { computeRelevance, daysUntil } from '@/lib/buzz/relevance';
import { addDays, daysBetween, isValidISODate, todayISO } from '@/lib/buzz/dates';

// ─────────────────────────────────────────────────────────────────────────────
// Reporting
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

const errors: string[] = [];
const warnings: string[] = [];

const err = (where: string, msg: string) => errors.push(`${where}: ${msg}`);
const warn = (where: string, msg: string) => warnings.push(`${where}: ${msg}`);

const h1 = (s: string) =>
  console.log(`\n${C.bold}${C.cyan}── ${s} ${'─'.repeat(Math.max(0, 68 - s.length))}${C.reset}`);

// ─────────────────────────────────────────────────────────────────────────────
// Geographic reference data
// ─────────────────────────────────────────────────────────────────────────────

/** [lonMin, latMin, lonMax, latMax]. Generous — these catch blunders, not metres. */
type BBox = [number, number, number, number];

/**
 * Country bounding boxes. Multi-box entries cover genuinely disjoint territory
 * that shares an ISO-2 code (Alaska/Hawaii, the Canaries, the Azores).
 * Comfortably more than the top-30-by-event-count the brief asks for.
 */
const COUNTRY_BBOX: Record<string, BBox[]> = {
  AD: [[1.41, 42.42, 1.79, 42.66]],
  AE: [[51.5, 22.6, 56.4, 26.1]],
  AG: [[-62.0, 16.9, -61.6, 17.8]],
  AL: [[19.26, 39.6, 21.06, 42.7]],
  AR: [[-73.6, -55.1, -53.6, -21.7]],
  AT: [[9.5, 46.3, 17.2, 49.1]],
  AU: [[112.9, -43.8, 153.7, -9.9]],
  AZ: [[44.7, 38.3, 50.4, 41.95]],
  BB: [[-59.7, 12.98, -59.4, 13.36]],
  BE: [[2.5, 49.4, 6.42, 51.56]],
  BG: [[22.3, 41.2, 28.7, 44.25]],
  BM: [[-64.9, 32.2, -64.6, 32.4]],
  BR: [[-74.1, -33.8, -34.7, 5.4]],
  BS: [[-79.1, 20.8, -72.6, 27.4]],
  BT: [[88.7, 26.7, 92.15, 28.4]],
  BW: [[19.9, -27.0, 29.4, -17.7]],
  CA: [[-141.1, 41.6, -52.5, 83.2]],
  CH: [[5.9, 45.8, 10.55, 47.85]],
  CL: [[-75.8, -56.0, -66.3, -17.4]],
  CN: [[73.4, 17.9, 135.1, 53.6]],
  CO: [[-79.2, -4.3, -66.8, 12.7]],
  CR: [[-86.0, 7.9, -82.5, 11.3]],
  CY: [[32.2, 34.5, 34.65, 35.75]],
  CZ: [[12.05, 48.5, 18.9, 51.1]],
  DE: [[5.8, 47.2, 15.1, 55.1]],
  DK: [[7.9, 54.4, 15.3, 57.8]],
  DO: [[-72.1, 17.5, -68.3, 20.0]],
  EC: [[-81.1, -5.1, -75.1, 1.5], [-92.1, -1.5, -89.1, 0.8]],
  EG: [[24.6, 21.9, 36.95, 31.75]],
  ES: [[-9.4, 35.9, 4.4, 43.85], [-18.3, 27.5, -13.3, 29.5]],
  FI: [[19.4, 59.6, 31.7, 70.2]],
  FJ: [[176.8, -19.3, 180.0, -15.9], [-180.0, -19.3, -178.0, -15.9]],
  FR: [[-5.3, 41.3, 9.7, 51.2]],
  GB: [[-8.8, 49.8, 1.9, 60.95]],
  GE: [[39.9, 41.0, 46.8, 43.65]],
  GL: [[-73.5, 59.7, -11.2, 83.8]],
  GR: [[19.3, 34.7, 29.8, 41.8]],
  GT: [[-92.3, 13.6, -88.1, 17.9]],
  HK: [[113.8, 22.1, 114.5, 22.6]],
  HR: [[13.4, 42.3, 19.5, 46.6]],
  HU: [[16.1, 45.7, 22.95, 48.6]],
  ID: [[94.9, -11.2, 141.1, 6.2]],
  IE: [[-10.6, 51.4, -5.9, 55.5]],
  IL: [[34.2, 29.4, 35.95, 33.4]],
  IN: [[68.1, 6.7, 97.5, 35.6]],
  IS: [[-24.7, 63.2, -13.4, 66.7]],
  IT: [[6.6, 35.4, 18.6, 47.15]],
  JM: [[-78.5, 17.6, -76.1, 18.6]],
  JO: [[34.9, 29.1, 39.4, 33.4]],
  JP: [[122.8, 24.0, 154.0, 45.6]],
  KE: [[33.8, -4.8, 42.0, 5.6]],
  KH: [[102.2, 10.3, 107.7, 14.8]],
  KN: [[-62.9, 17.0, -62.5, 17.5]],
  KR: [[125.0, 33.0, 131.1, 38.7]],
  KY: [[-81.5, 19.2, -79.7, 19.8]],
  KZ: [[46.4, 40.5, 87.4, 55.5]],
  LC: [[-61.1, 13.7, -60.8, 14.2]],
  LI: [[9.45, 47.04, 9.66, 47.29]],
  LK: [[79.5, 5.8, 82.0, 10.0]],
  LU: [[5.7, 49.4, 6.6, 50.2]],
  MA: [[-13.3, 27.6, -0.9, 36.0]],
  MC: [[7.35, 43.70, 7.47, 43.79]],
  ME: [[18.4, 41.8, 20.4, 43.6]],
  MM: [[92.1, 9.7, 101.2, 28.6]],
  MN: [[87.6, 41.5, 120.0, 52.2]],
  MQ: [[-61.3, 14.3, -60.8, 14.9]],
  MT: [[14.1, 35.7, 14.6, 36.1]],
  MU: [[57.2, -20.6, 63.6, -10.2]],
  MV: [[72.5, -0.8, 73.8, 7.2]],
  MX: [[-118.5, 14.4, -86.6, 32.8]],
  MY: [[99.5, 0.8, 119.4, 7.5]],
  NA: [[11.6, -29.1, 25.3, -16.9]],
  NL: [[3.3, 50.7, 7.3, 53.6]],
  NO: [[4.5, 57.9, 31.2, 71.3]],
  NP: [[80.0, 26.3, 88.3, 30.5]],
  NZ: [[166.3, -47.4, 178.7, -34.3]],
  OM: [[51.9, 16.6, 60.0, 26.5]],
  PA: [[-83.1, 7.1, -77.1, 9.7]],
  PE: [[-81.4, -18.4, -68.6, 0.1]],
  PF: [[-152.9, -27.8, -134.8, -7.8]],
  PH: [[116.8, 4.5, 126.7, 21.2]],
  PL: [[14.1, 49.0, 24.2, 55.0]],
  PT: [[-9.6, 36.9, -6.1, 42.2], [-17.3, 32.4, -16.2, 33.2], [-31.4, 36.9, -24.9, 39.8]],
  QA: [[50.7, 24.4, 51.7, 26.2]],
  RO: [[20.2, 43.6, 29.8, 48.3]],
  RS: [[18.8, 42.2, 23.1, 46.2]],
  RU: [[19.6, 41.1, 180.0, 82.0], [-180.0, 62.0, -168.0, 72.0]],
  RW: [[28.8, -2.9, 30.9, -1.0]],
  SA: [[34.4, 16.3, 55.7, 32.2]],
  SC: [[46.1, -10.4, 56.4, -3.6]],
  SE: [[11.0, 55.2, 24.3, 69.1]],
  SG: [[103.6, 1.14, 104.1, 1.49]],
  SI: [[13.3, 45.4, 16.7, 46.9]],
  TC: [[-72.6, 21.2, -71.0, 22.0]],
  TH: [[97.3, 5.5, 105.7, 20.5]],
  TR: [[25.6, 35.8, 45.0, 42.2]],
  TW: [[119.2, 21.8, 122.2, 25.4]],
  TZ: [[29.2, -11.8, 40.5, -0.9]],
  UA: [[22.1, 44.3, 40.3, 52.4]],
  US: [[-125.1, 24.4, -66.9, 49.5], [-172.5, 51.0, -129.9, 71.5], [-160.3, 18.9, -154.7, 22.3]],
  UY: [[-58.5, -35.0, -53.1, -30.0]],
  UZ: [[55.9, 37.1, 73.2, 45.6]],
  VG: [[-64.8, 18.3, -64.2, 18.8]],
  VI: [[-65.1, 17.6, -64.5, 18.5]],
  VN: [[102.1, 8.1, 109.5, 23.4]],
  ZA: [[16.4, -35.0, 33.0, -22.1]],
  ZM: [[21.9, -18.1, 33.8, -8.2]],
  ZW: [[25.2, -22.5, 33.1, -15.6]],
};

/**
 * City gazetteer for the ~150km proximity check. Covers the destinations that
 * dominate this calendar. A city that is absent is simply not checked (and
 * counted in the coverage line) — a missing city is not an error.
 */
const CITY_COORDS: Record<string, [number, number]> = {
  // lat, lon
  'abu dhabi': [24.4539, 54.3773],
  amsterdam: [52.3676, 4.9041],
  arles: [43.6768, 4.6277],
  aspen: [39.1911, -106.8175],
  athens: [37.9838, 23.7275],
  austin: [30.2672, -97.7431],
  'baden-baden': [48.7606, 8.2396],
  bali: [-8.4095, 115.1889],
  bangkok: [13.7563, 100.5018],
  barcelona: [41.3874, 2.1686],
  basel: [47.5596, 7.5886],
  berlin: [52.52, 13.405],
  'beverly hills': [34.0736, -118.4004],
  bilbao: [43.263, -2.935],
  bodrum: [37.0344, 27.4305],
  'buenos aires': [-34.6037, -58.3816],
  cannes: [43.5528, 7.0174],
  'cape town': [-33.9249, 18.4241],
  capri: [40.5532, 14.2222],
  chamonix: [45.9237, 6.8694],
  chantilly: [49.1936, 2.4711],
  charleston: [32.7765, -79.9311],
  'cortina d ampezzo': [46.5405, 12.1357],
  courchevel: [45.4147, 6.6347],
  'crans-montana': [46.3117, 7.4808],
  daegu: [35.8714, 128.6014],
  dallas: [32.7767, -96.797],
  'deer valley': [40.6374, -111.4783],
  doha: [25.2854, 51.531],
  dubai: [25.2048, 55.2708],
  dublin: [53.3498, -6.2603],
  edinburgh: [55.9533, -3.1883],
  florence: [43.7696, 11.2558],
  gstaad: [46.4725, 7.2861],
  helsinki: [60.1699, 24.9384],
  'hong kong': [22.3193, 114.1694],
  'hua hin': [12.5684, 99.9577],
  ibiza: [38.9067, 1.4206],
  istanbul: [41.0082, 28.9784],
  jackson: [43.4799, -110.7624],
  'jackson hole': [43.4799, -110.7624],
  jaipur: [26.9124, 75.7873],
  kitzbuhel: [47.4467, 12.3922],
  'kuala lumpur': [3.139, 101.6869],
  kyoto: [35.0116, 135.768],
  lisbon: [38.7223, -9.1393],
  london: [51.5074, -0.1278],
  'los angeles': [34.0522, -118.2437],
  lucerne: [47.0502, 8.3093],
  madrid: [40.4168, -3.7038],
  marbella: [36.5101, -4.8825],
  marrakech: [31.6295, -7.9811],
  megeve: [45.8567, 6.6178],
  melbourne: [-37.8136, 144.9631],
  'mexico city': [19.4326, -99.1332],
  miami: [25.7617, -80.1918],
  milan: [45.4642, 9.19],
  monaco: [43.7384, 7.4246],
  'monte carlo': [43.7396, 7.4276],
  montreal: [45.5017, -73.5673],
  moscow: [55.7558, 37.6173],
  mumbai: [19.076, 72.8777],
  munich: [48.1351, 11.582],
  'new york': [40.7128, -74.006],
  nice: [43.7102, 7.262],
  oslo: [59.9139, 10.7522],
  paris: [48.8566, 2.3522],
  'palm beach': [26.7056, -80.0364],
  'palm springs': [33.8303, -116.5453],
  'porto cervo': [41.1355, 9.5362],
  portofino: [44.3036, 9.2097],
  prague: [50.0755, 14.4378],
  reykjavik: [64.1466, -21.9426],
  rome: [41.9028, 12.4964],
  'san francisco': [37.7749, -122.4194],
  'san sebastian': [43.3183, -1.9812],
  'sankt moritz': [46.4908, 9.8355],
  santorini: [36.3932, 25.4615],
  'sao paulo': [-23.5505, -46.6333],
  seoul: [37.5665, 126.978],
  seville: [37.3891, -5.9845],
  shanghai: [31.2304, 121.4737],
  singapore: [1.3521, 103.8198],
  'st barthelemy': [17.9, -62.8333],
  'st moritz': [46.4908, 9.8355],
  'st tropez': [43.2677, 6.6407],
  'saint-tropez': [43.2677, 6.6407],
  stockholm: [59.3293, 18.0686],
  sydney: [-33.8688, 151.2093],
  taipei: [25.033, 121.5654],
  tokyo: [35.6762, 139.6503],
  toronto: [43.6532, -79.3832],
  valletta: [35.8989, 14.5146],
  vail: [39.6403, -106.3742],
  venice: [45.4408, 12.3155],
  verbier: [46.0961, 7.2286],
  vienna: [48.2082, 16.3738],
  zermatt: [46.0207, 7.7491],
  zurich: [47.3769, 8.5417],
};

const inBox = (lat: number, lon: number, b: BBox): boolean =>
  lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];

const inCountry = (lat: number, lon: number, boxes: BBox[]): boolean =>
  boxes.some((b) => inBox(lat, lon, b));

/** Great-circle distance in km. */
function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

const normaliseCity = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Gazetteer re-keyed through `normaliseCity`, so `Baden-Baden`, `baden baden`
 * and `Baden\u2011Baden` all resolve. Built once at load.
 */
const CITY_INDEX: Map<string, [number, number]> = new Map(
  Object.entries(CITY_COORDS).map(([k, v]) => [normaliseCity(k), v]),
);

// ─────────────────────────────────────────────────────────────────────────────
// 1. Structural validation
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_SET = new Set<string>(EVENT_CATEGORIES);
const TIERS = new Set(['legendary', 'marquee', 'insider']);
const RECURRENCES = new Set(['annual', 'seasonal', 'biennial', 'one-off']);
const FBO = new Set(['exceptional', 'excellent', 'adequate']);

function validateStructure(events: WorldEvent[]): void {
  const seenIds = new Set<string>();

  for (const e of events) {
    const at = `${C.dim}[${e.id ?? '<no id>'}]${C.reset}`;

    // Identity
    if (!e.id || typeof e.id !== 'string') err(at, 'missing id');
    else {
      if (seenIds.has(e.id)) err(at, 'duplicate id');
      seenIds.add(e.id);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(e.id)) {
        warn(at, `id is not a lowercase slug: "${e.id}"`);
      }
    }

    // Required non-empty strings
    for (const field of [
      'name',
      'tagline',
      'city',
      'country',
      'countryCode',
      'timezone',
      'accessNote',
      'description',
    ] as const) {
      const v = e[field];
      if (typeof v !== 'string' || !v.trim()) err(at, `empty required field "${field}"`);
    }

    if (e.tagline && e.tagline.length > 90) {
      err(at, `tagline is ${e.tagline.length} chars (max 90): "${e.tagline.slice(0, 60)}…"`);
    }
    if (e.tagline && /\.$/.test(e.tagline.trim())) {
      warn(at, 'tagline ends with a period (contract says no trailing period)');
    }

    // Enums
    if (!CATEGORY_SET.has(e.category)) err(at, `unknown category "${e.category}"`);
    for (const c of e.secondaryCategories ?? []) {
      if (!CATEGORY_SET.has(c)) err(at, `unknown secondary category "${c}"`);
      if (c === e.category) warn(at, `secondary category duplicates primary "${c}"`);
    }
    if (!TIERS.has(e.tier)) err(at, `unknown tier "${e.tier}"`);
    if (!RECURRENCES.has(e.recurrence)) err(at, `unknown recurrence "${e.recurrence}"`);

    // Dates
    if (!isValidISODate(e.start)) err(at, `invalid start date "${e.start}"`);
    if (!isValidISODate(e.end)) err(at, `invalid end date "${e.end}"`);
    if (isValidISODate(e.start) && isValidISODate(e.end)) {
      if (e.end < e.start) err(at, `end (${e.end}) precedes start (${e.start})`);
      const span = daysBetween(e.start, e.end);
      if (span > 120) warn(at, `spans ${span} days — is that intentional?`);
    }

    // Timezone
    if (e.timezone && !/^[A-Za-z]+\/[A-Za-z_+\-0-9]+(?:\/[A-Za-z_]+)?$/.test(e.timezone)) {
      if (e.timezone !== 'UTC') warn(at, `timezone "${e.timezone}" is not an IANA zone`);
    }

    // Coordinates
    const { lat, lon } = e.coords ?? ({} as { lat: number; lon: number });
    if (typeof lat !== 'number' || !Number.isFinite(lat)) err(at, 'lat is not a finite number');
    else if (lat < -90 || lat > 90) err(at, `lat ${lat} out of range [-90, 90]`);
    if (typeof lon !== 'number' || !Number.isFinite(lon)) err(at, 'lon is not a finite number');
    else if (lon < -180 || lon > 180) err(at, `lon ${lon} out of range [-180, 180]`);

    // Country code
    if (e.countryCode && !/^[A-Z]{2}$/.test(e.countryCode)) {
      err(at, `countryCode "${e.countryCode}" is not uppercase ISO 3166-1 alpha-2`);
    }

    // Price
    if (![1, 2, 3, 4, 5].includes(e.priceIndex as number)) {
      err(at, `priceIndex ${e.priceIndex} not in 1..5`);
    }
    const spend = e.estimatedSpend;
    if (!spend || typeof spend.min !== 'number' || typeof spend.max !== 'number') {
      err(at, 'estimatedSpend missing min/max');
    } else {
      if (spend.min < 0) err(at, `estimatedSpend.min is negative (${spend.min})`);
      if (spend.max < spend.min) {
        err(at, `estimatedSpend.max (${spend.max}) < min (${spend.min})`);
      }
      if (spend.currency !== 'USD') err(at, `estimatedSpend.currency must be USD`);
    }

    // whyGo
    if (!Array.isArray(e.whyGo)) err(at, 'whyGo is not an array');
    else {
      if (e.whyGo.length < 3 || e.whyGo.length > 5) {
        err(at, `whyGo has ${e.whyGo.length} items (contract: 3–5)`);
      }
      e.whyGo.forEach((w, i) => {
        if (!w || !w.trim()) err(at, `whyGo[${i}] is empty`);
        else if (w.length > 80) err(at, `whyGo[${i}] is ${w.length} chars (max 80)`);
      });
    }

    // Collections
    if (!Array.isArray(e.venues) || e.venues.length === 0) err(at, 'venues is empty');
    if (!Array.isArray(e.tags) || e.tags.length === 0) err(at, 'tags is empty');
    if (Array.isArray(e.tags) && new Set(e.tags).size !== e.tags.length) {
      warn(at, 'tags contains duplicates');
    }

    // Description quality
    if (e.description && e.description.length < 80) {
      warn(at, `description is only ${e.description.length} chars — contract asks for 2–4 sentences`);
    }

    // Jet port
    const jp = e.nearestJetPort;
    if (!jp) err(at, 'nearestJetPort missing');
    else {
      if (!jp.code || !/^[A-Z0-9]{3,4}$/.test(jp.code)) {
        err(at, `nearestJetPort.code "${jp.code}" is not a 3–4 char ICAO/IATA identifier`);
      }
      if (!jp.name?.trim()) err(at, 'nearestJetPort.name is empty');
      if (!FBO.has(jp.fboQuality)) err(at, `unknown fboQuality "${jp.fboQuality}"`);
      const c = jp.coords;
      if (!c || typeof c.lat !== 'number' || typeof c.lon !== 'number') {
        err(at, 'nearestJetPort.coords missing');
      } else {
        if (c.lat < -90 || c.lat > 90) err(at, `jet port lat ${c.lat} out of range`);
        if (c.lon < -180 || c.lon > 180) err(at, `jet port lon ${c.lon} out of range`);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          const d = haversineKm(lat, lon, c.lat, c.lon);
          if (d > 400) {
            warn(at, `nearest jet port ${jp.code} is ${Math.round(d)}km from the venue`);
          }
        }
      }
    }

    // Signals
    const s = e.signals;
    if (!s) err(at, 'signals missing');
    else {
      for (const k of SIGNAL_KEYS) {
        if (typeof s[k] !== 'number' || !Number.isFinite(s[k])) {
          err(at, `signals.${k} is not a finite number`);
        }
      }
      if (s.socialMentions < 0) err(at, `signals.socialMentions is negative`);
      if (s.mediaMentions < 0) err(at, `signals.mediaMentions is negative`);
      if (s.socialVelocity < -1 || s.socialVelocity > 1) {
        err(at, `signals.socialVelocity ${s.socialVelocity} outside -1..1`);
      }
      if (s.searchInterest < 0 || s.searchInterest > 100) {
        err(at, `signals.searchInterest ${s.searchInterest} outside 0..100`);
      }
      if (s.bookingPressure < 0 || s.bookingPressure > 1) {
        err(at, `signals.bookingPressure ${s.bookingPressure} outside 0..1`);
      }
      if (s.exclusivity < 0 || s.exclusivity > 1) {
        err(at, `signals.exclusivity ${s.exclusivity} outside 0..1`);
      }
    }
  }

  // EVENT_INDEX agreement
  if (EVENT_INDEX.size !== events.length) {
    err('EVENT_INDEX', `has ${EVENT_INDEX.size} entries but EVENTS has ${events.length}`);
  }
  for (const e of events) {
    if (EVENT_INDEX.get(e.id) !== e) {
      err('EVENT_INDEX', `entry for "${e.id}" is missing or not identical to the EVENTS record`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Geography
// ─────────────────────────────────────────────────────────────────────────────

interface GeoStats {
  bboxChecked: number;
  bboxMissing: Set<string>;
  cityChecked: number;
  citySkipped: number;
  swapped: number;
}

function validateGeography(events: WorldEvent[]): GeoStats {
  const stats: GeoStats = {
    bboxChecked: 0,
    bboxMissing: new Set(),
    cityChecked: 0,
    citySkipped: 0,
    swapped: 0,
  };

  for (const e of events) {
    const at = `${C.dim}[${e.id}]${C.reset}`;
    const lat = e.coords?.lat;
    const lon = e.coords?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const boxes = COUNTRY_BBOX[e.countryCode];
    if (!boxes) {
      stats.bboxMissing.add(e.countryCode);
    } else {
      stats.bboxChecked++;
      if (!inCountry(lat, lon, boxes)) {
        // The classic failure: lat and lon transposed. Check it explicitly so
        // the error message tells the author exactly what to do.
        const swappable =
          Math.abs(lon) <= 90 && inCountry(lon, lat, boxes);
        if (swappable) {
          stats.swapped++;
          err(
            at,
            `${C.red}SWAPPED lat/lon${C.reset} — coords {lat:${lat}, lon:${lon}} are outside ` +
              `${e.countryCode} but {lat:${lon}, lon:${lat}} are inside it`,
          );
        } else {
          err(
            at,
            `coords {lat:${lat}, lon:${lon}} fall outside ${e.countryCode} ` +
              `(${e.country}); bbox ${JSON.stringify(boxes)}`,
          );
        }
      }
    }

    // City proximity
    const key = normaliseCity(e.city);
    const ref = CITY_INDEX.get(key);
    if (!ref) {
      stats.citySkipped++;
    } else {
      stats.cityChecked++;
      const d = haversineKm(lat, lon, ref[0], ref[1]);
      if (d > 150) {
        err(
          at,
          `coords are ${Math.round(d)}km from ${e.city} (gazetteer ${ref[0]}, ${ref[1]}) — ` +
            `expected within 150km`,
        );
      } else if (d > 60) {
        warn(at, `coords are ${Math.round(d)}km from the centre of ${e.city}`);
      }
    }
  }

  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Buzz engine
// ─────────────────────────────────────────────────────────────────────────────

function validateEngine(events: WorldEvent[], now: string) {
  const scores = scoreEvents(events, { now });

  // Component sum invariant — the one stated in types.ts.
  let worstDrift = 0;
  for (const s of scores) {
    const sum = SIGNAL_KEYS.reduce((a, k) => a + s.components[k], 0);
    worstDrift = Math.max(worstDrift, Math.abs(sum - s.score));
    if (!assertComponentsSum(s)) {
      err(
        `${C.dim}[${s.eventId}]${C.reset}`,
        `components sum to ${sum.toFixed(9)} but score is ${s.score.toFixed(9)}`,
      );
    }
    if (s.score < 0 || s.score > 100) err(`[${s.eventId}]`, `score ${s.score} outside 0..100`);
    if (s.trend < -1 || s.trend > 1) err(`[${s.eventId}]`, `trend ${s.trend} outside -1..1`);
    if (!HEAT_LEVELS.includes(s.heat)) err(`[${s.eventId}]`, `unknown heat "${s.heat}"`);
  }

  // Ranks: exactly 1..n, no gaps, no duplicates.
  const ranks = scores.map((s) => s.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) {
      err('ranks', `expected rank ${i + 1} at position ${i}, found ${ranks[i]}`);
      break;
    }
  }
  if (new Set(ranks).size !== ranks.length) err('ranks', 'duplicate ranks present');

  // Determinism: same inputs must give byte-identical output.
  const again = scoreEvents(events, { now });
  if (JSON.stringify(again) !== JSON.stringify(scores)) {
    err('determinism', 'scoreEvents is not deterministic for identical inputs');
  }

  // Past events must score exactly 0.
  for (const e of events) {
    if (e.end < now) {
      const s = scores.find((x) => x.eventId === e.id);
      if (s && s.score !== 0) err(`[${e.id}]`, `finished event scores ${s.score}, expected 0`);
    }
  }

  // Peer lift must not manufacture a supernova out of nothing.
  const coldest = [...events].sort(
    (a, b) => a.signals.socialMentions - b.signals.socialMentions,
  )[0];
  if (coldest) {
    const withPeers = scoreEvents([coldest], {
      now,
      peerCounts: { [coldest.id]: 5_000 },
    })[0];
    const without = scoreEvents([coldest], { now })[0];
    if (withPeers.score > without.score * 1.19 + 1e-6) {
      err('peer lift', `uplift exceeded the +18% cap (${without.score} → ${withPeers.score})`);
    }
  }

  // Relevance behaviour.
  const sample = events.find((e) => e.end > e.start) ?? events[0];
  if (sample) {
    const at = `[${sample.id}]`;
    if (computeRelevance(sample, sample.start, 10) !== 1) {
      err(at, 'relevance is not 1.0 on the event start date');
    }
    if (computeRelevance(sample, sample.end, 10) !== 1) {
      err(at, 'relevance is not 1.0 on the event end date');
    }
    const far = computeRelevance(sample, addDays(sample.end, 26), 10);
    if (far !== 0) err(at, `relevance is ${far} beyond the 2.5× horizon, expected 0`);
    const near = computeRelevance(sample, addDays(sample.end, 5), 10);
    const mid = computeRelevance(sample, addDays(sample.end, 15), 10);
    if (!(near > mid && mid > far)) err(at, 'relevance is not monotonically decreasing');
    if (daysUntil(sample, sample.start) !== 0) err(at, 'daysUntil is not 0 at the start date');
  }

  return { scores, worstDrift };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reports
// ─────────────────────────────────────────────────────────────────────────────

const bar = (n: number, max: number, width = 34): string =>
  '█'.repeat(Math.round((n / Math.max(1, max)) * width));

const pct = (n: number, total: number): string =>
  `${((n / Math.max(1, total)) * 100).toFixed(1)}%`;

/** Target distribution from the product brief, used only for the ✓/△ marker. */
const HEAT_TARGET: Record<HeatLevel, [number, number]> = {
  supernova: [2.5, 6.0],
  blazing: [7.0, 14.0],
  hot: [15.0, 26.0],
  warm: [24.0, 38.0],
  smoldering: [20.0, 55.0],
};

function reportHeat(scores: { heat: HeatLevel; score: number }[], liveTotal: number): void {
  h1('HEAT DISTRIBUTION');
  const counts = new Map<HeatLevel, number>(HEAT_LEVELS.map((h) => [h, 0]));
  for (const s of scores) counts.set(s.heat, (counts.get(s.heat) ?? 0) + 1);

  const max = Math.max(...counts.values());
  console.log(
    `${C.dim}Across ${scores.length} events (${liveTotal} still upcoming; finished events score 0 and land in smoldering).${C.reset}\n`,
  );
  for (const level of [...HEAT_LEVELS].reverse()) {
    const n = counts.get(level) ?? 0;
    const p = (n / Math.max(1, scores.length)) * 100;
    const [lo, hi] = HEAT_TARGET[level];
    const ok = p >= lo && p <= hi;
    const mark = ok ? `${C.green}✓${C.reset}` : `${C.yellow}△${C.reset}`;
    console.log(
      `  ${mark} ${level.padEnd(11)} ${String(n).padStart(4)}  ${p.toFixed(1).padStart(5)}%  ` +
        `${C.dim}target ${lo}–${hi}%${C.reset}  ${C.magenta}${bar(n, max)}${C.reset}`,
    );
  }

  // Excluding finished events — the distribution a member actually sees.
  const live = scores.filter((s) => s.score > 0);
  if (live.length && live.length !== scores.length) {
    const liveCounts = new Map<HeatLevel, number>(HEAT_LEVELS.map((h) => [h, 0]));
    for (const s of live) liveCounts.set(s.heat, (liveCounts.get(s.heat) ?? 0) + 1);
    console.log(`\n  ${C.dim}Upcoming events only (n=${live.length}):${C.reset}`);
    for (const level of [...HEAT_LEVELS].reverse()) {
      const n = liveCounts.get(level) ?? 0;
      console.log(
        `    ${level.padEnd(11)} ${String(n).padStart(4)}  ${pct(n, live.length).padStart(6)}`,
      );
    }
  }

  const values = scores.map((s) => s.score).sort((a, b) => a - b);
  const q = (p: number) => values[Math.min(values.length - 1, Math.floor(p * values.length))];
  console.log(
    `\n  ${C.dim}score quantiles — min ${q(0).toFixed(1)} · p25 ${q(0.25).toFixed(1)} · ` +
      `median ${q(0.5).toFixed(1)} · p75 ${q(0.75).toFixed(1)} · p95 ${q(0.95).toFixed(1)} · ` +
      `max ${q(0.999).toFixed(1)}${C.reset}`,
  );
}

function reportTop(
  events: WorldEvent[],
  scores: { eventId: string; score: number; heat: HeatLevel; rank: number; trend: number }[],
  now: string,
  n: number,
): void {
  h1(`TOP ${n} BY BUZZ`);
  const byId = new Map(events.map((e) => [e.id, e]));
  console.log(
    `${C.dim}  #  score  heat        d+     event${' '.repeat(30)}city${C.reset}`,
  );
  for (const s of scores.slice(0, n)) {
    const e = byId.get(s.eventId);
    if (!e) continue;
    const d = daysBetween(now, e.start);
    console.log(
      `  ${String(s.rank).padStart(3)}  ${s.score.toFixed(1).padStart(5)}  ` +
        `${s.heat.padEnd(11)} ${String(d).padStart(4)}  ` +
        `${e.name.slice(0, 42).padEnd(43)} ${C.dim}${e.city}, ${e.countryCode}${C.reset}`,
    );
  }
}

function reportCategories(events: WorldEvent[], scoreById: Map<string, number>): void {
  h1('CATEGORY DISTRIBUTION');
  const acc = new Map<EventCategory, { n: number; sum: number }>();
  for (const e of events) {
    const cur = acc.get(e.category) ?? { n: 0, sum: 0 };
    cur.n += 1;
    cur.sum += scoreById.get(e.id) ?? 0;
    acc.set(e.category, cur);
  }
  const rows = [...acc.entries()].sort((a, b) => b[1].n - a[1].n);
  const max = Math.max(...rows.map((r) => r[1].n));
  for (const [cat, { n, sum }] of rows) {
    console.log(
      `  ${cat.padEnd(12)} ${String(n).padStart(4)}  ${C.dim}avg ${(sum / n).toFixed(1).padStart(5)}${C.reset}  ` +
        `${C.cyan}${bar(n, max, 28)}${C.reset}`,
    );
  }
  const missing = EVENT_CATEGORIES.filter((c) => !acc.has(c));
  if (missing.length) {
    warn('categories', `no events in: ${missing.join(', ')}`);
  }
}

function reportMonths(events: WorldEvent[]): void {
  h1('MONTH DISTRIBUTION');
  const acc = new Map<string, number>();
  for (const e of events) {
    if (!isValidISODate(e.start)) continue;
    const key = e.start.slice(0, 7);
    acc.set(key, (acc.get(key) ?? 0) + 1);
  }
  const rows = [...acc.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const max = Math.max(...rows.map((r) => r[1]));
  for (const [month, n] of rows) {
    console.log(
      `  ${month}  ${String(n).padStart(4)}  ${C.green}${bar(n, max, 40)}${C.reset}`,
    );
  }
  const empty = rows.filter(([, n]) => n === 0);
  if (empty.length) warn('months', `${empty.length} months with no events`);
}

function reportCoverage(stats: GeoStats, total: number): void {
  h1('GEOGRAPHIC COVERAGE');
  console.log(
    `  country bbox checked   ${stats.bboxChecked}/${total} (${pct(stats.bboxChecked, total)})`,
  );
  console.log(
    `  city proximity checked ${stats.cityChecked}/${total} (${pct(stats.cityChecked, total)}), ` +
      `${stats.citySkipped} not in gazetteer`,
  );
  console.log(`  swapped lat/lon found  ${stats.swapped}`);
  if (stats.bboxMissing.size) {
    console.log(
      `  ${C.dim}no bbox for: ${[...stats.bboxMissing].sort().join(', ')}${C.reset}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function main(): number {
  const argTop = process.argv.indexOf('--top');
  const topN = argTop >= 0 ? Number.parseInt(process.argv[argTop + 1] ?? '20', 10) || 20 : 20;
  const now = todayISO();

  console.log(
    `${C.bold}MERIDIAN data validation${C.reset}  ${C.dim}${EVENTS.length} events · reference date ${now}${C.reset}`,
  );

  if (!Array.isArray(EVENTS) || EVENTS.length === 0) {
    console.error(`${C.red}FATAL: EVENTS is empty or not an array.${C.reset}`);
    return 1;
  }

  validateStructure(EVENTS);
  const geo = validateGeography(EVENTS);
  const { scores, worstDrift } = validateEngine(EVENTS, now);

  const scoreById = new Map(scores.map((s) => [s.eventId, s.score]));
  const upcoming = EVENTS.filter((e) => e.end >= now).length;

  reportHeat(scores, upcoming);
  reportTop(EVENTS, scores, now, topN);
  reportCategories(EVENTS, scoreById);
  reportMonths(EVENTS);
  reportCoverage(geo, EVENTS.length);

  h1('ENGINE INVARIANTS');
  console.log(
    `  components sum to score   worst drift ${worstDrift.toExponential(2)} ` +
      `${worstDrift <= 1e-6 ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`}`,
  );
  console.log(`  ranks 1..${scores.length} contiguous  ${C.green}✓${C.reset}`);
  console.log(`  deterministic re-run       ${C.green}✓${C.reset}`);

  h1('RESULT');
  if (warnings.length) {
    console.log(`${C.yellow}${warnings.length} warning(s):${C.reset}`);
    for (const w of warnings.slice(0, 60)) console.log(`  ${C.yellow}warn${C.reset} ${w}`);
    if (warnings.length > 60) console.log(`  ${C.dim}… ${warnings.length - 60} more${C.reset}`);
  }
  if (errors.length) {
    console.log(`\n${C.red}${errors.length} error(s):${C.reset}`);
    for (const e of errors.slice(0, 120)) console.log(`  ${C.red}FAIL${C.reset} ${e}`);
    if (errors.length > 120) console.log(`  ${C.dim}… ${errors.length - 120} more${C.reset}`);
    console.log(`\n${C.red}${C.bold}VALIDATION FAILED${C.reset}`);
    return 1;
  }

  console.log(
    `\n${C.green}${C.bold}ALL CHECKS PASSED${C.reset} ${C.dim}(${warnings.length} warning(s))${C.reset}`,
  );
  return 0;
}

process.exit(main());
