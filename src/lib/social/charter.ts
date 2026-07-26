/**
 * MERIDIAN — charter economics.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS MODELLED, AND WHAT IS NOT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This produces an *indicative* round-trip charter price. It is deliberately
 * built the way a broker builds one — block hours × wet hourly rate, plus the
 * lines that always appear underneath — so the numbers survive being held up
 * next to a real quote. They will not match it to the dollar. Nothing does; two
 * real operators quoting the same leg on the same day differ by 20–30%.
 *
 * MODELLED
 *   • Great-circle distance, then a routing factor. Airways, ATC vectoring,
 *     oceanic tracks and weather deviation make the flown track 4–6% longer
 *     than the great circle. We use 5%.
 *   • Block time, not air time. Taxi out, climb below cruise speed, descent,
 *     approach and taxi in cost roughly 20–25 minutes a leg regardless of
 *     distance; we add a flat 0.35 h per leg on top of cruise-speed time.
 *   • Round trip. The whole point of this product is a group going somewhere
 *     and coming back, so every quote is two occupied legs.
 *   • Repositioning. The aircraft is almost never parked where you are. We bill
 *     a nominal 1.0 h of ferry across the trip. Real quotes vary enormously —
 *     a based aircraft is 0, a one-way from an awkward field can be 3 h+.
 *   • Crew. Two pilots (three above the augmentation threshold) plus a cabin
 *     attendant on heavy metal. Per-diem and hotel while the aircraft waits out
 *     the event, at a flat day rate over an assumed 3-day trip.
 *   • Handling. Landing, parking, FBO, navigation and overflight charges, per
 *     leg, scaled by aircraft weight class. Ferry legs incur them too.
 *   • Fuel escalator. Operators contract Jet-A at an index and pass through the
 *     difference; 6% of the flight subtotal is a normal 2026 escalator.
 *   • Tax. 7.5% on the flight subtotal — this is US Federal Excise Tax. It is
 *     used here as a stand-in for the equivalent burden elsewhere (EU VAT on
 *     intra-community legs, UK APD, various departure taxes). Genuine
 *     simplification: real international structuring differs materially.
 *   • Range feasibility with a payload/reserve derate, and technical stops when
 *     no airframe in the catalogue can do the leg nonstop.
 *
 * NOT MODELLED — and these are the things that move a real quote
 *   • Winds aloft. A westbound North Atlantic crossing is meaningfully longer
 *     than eastbound. We price both directions identically.
 *   • Peak-date surcharges. A Nice arrival on Grand Prix Saturday, or Davos in
 *     January, carries a premium and a slot problem. Not in here.
 *   • Slot and parking constraints. At Nice, Farnborough, Samedan and Aspen
 *     during their events, ramp space is the binding constraint, not money.
 *   • Empty-leg and one-way pricing, fractional programmes, jet cards, block
 *     hour agreements — all of which beat this number if you have them.
 *   • De-icing, catering above standard, ground transfers, customs overtime.
 *   • Aircraft availability. A quote for an airframe nobody has free is fiction.
 *
 * Hourly rates are 2026 indicative wet retail (US/EU market, aircraft + crew +
 * insurance + maintenance reserve, before the fees above). Ranges and cruise
 * speeds are manufacturer figures for typical configurations.
 */

import { greatCircleDistanceNm } from '@/lib/geo/projection';
import type { CharterQuote, GeoPoint, JetOption } from '@/lib/types';

// ─────────────────────────────────────────────────────────────────────────────
// The catalogue
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ordered smallest to largest. `quoteCharter` walks this in order, so the
 * ordering *is* the "smallest suitable airframe" rule.
 *
 * `seats` is the realistic passenger count for a comfortable long-leg cabin,
 * not the maximum certified seating. A CJ3+ is certified for up to 9 with the
 * belted lav; nobody flies six hours that way.
 */
export const JETS: readonly JetOption[] = [
  {
    id: 'cj3plus',
    aircraft: 'Cessna Citation CJ3+',
    category: 'light',
    seats: 6,
    rangeNm: 2040,
    cruiseKts: 416,
    hourlyRate: 3900,
    note: 'The sensible short-haul answer. Gets into Samedan and London City-class fields',
  },
  {
    id: 'pc24',
    aircraft: 'Pilatus PC-24',
    category: 'light',
    seats: 8,
    rangeNm: 2000,
    cruiseKts: 440,
    hourlyRate: 4600,
    note: 'Lands on gravel and grass. The only reason to take it is where you are going',
  },
  {
    id: 'latitude',
    aircraft: 'Cessna Citation Latitude',
    category: 'midsize',
    seats: 8,
    rangeNm: 2700,
    cruiseKts: 446,
    hourlyRate: 4900,
    note: 'Flat floor and a stand-up cabin at midsize money',
  },
  {
    id: 'longitude',
    aircraft: 'Cessna Citation Longitude',
    category: 'super-midsize',
    seats: 9,
    rangeNm: 3500,
    cruiseKts: 476,
    hourlyRate: 5900,
    note: 'The quietest cabin in its class. Transcontinental without drama',
  },
  {
    id: 'praetor600',
    aircraft: 'Embraer Praetor 600',
    category: 'super-midsize',
    seats: 9,
    rangeNm: 4018,
    cruiseKts: 466,
    hourlyRate: 6400,
    note: 'Super-midsize with heavy-jet legs. Teterboro to Lisbon with reserves',
  },
  {
    id: 'ch350',
    aircraft: 'Bombardier Challenger 350',
    category: 'super-midsize',
    seats: 9,
    rangeNm: 3200,
    cruiseKts: 448,
    hourlyRate: 6800,
    note: 'The most-flown cabin in the class. Nothing surprises it',
  },
  {
    id: 'g280',
    aircraft: 'Gulfstream G280',
    category: 'super-midsize',
    seats: 9,
    rangeNm: 3600,
    cruiseKts: 459,
    hourlyRate: 6900,
    note: 'Climbs straight to FL430 and stays out of the weather',
  },
  {
    id: 'f2000lxs',
    aircraft: 'Dassault Falcon 2000LXS',
    category: 'heavy',
    seats: 10,
    rangeNm: 4000,
    cruiseKts: 470,
    hourlyRate: 7200,
    note: 'Heavy cabin, short-field manners. The London City of large jets',
  },
  {
    id: 'f8x',
    aircraft: 'Dassault Falcon 8X',
    category: 'ultra-long-range',
    seats: 13,
    rangeNm: 6450,
    cruiseKts: 488,
    hourlyRate: 11500,
    note: 'Three engines, a 43-foot cabin, and steep-approach approval for Samedan',
  },
  {
    id: 'g650er',
    aircraft: 'Gulfstream G650ER',
    category: 'ultra-long-range',
    seats: 14,
    rangeNm: 7500,
    cruiseKts: 516,
    hourlyRate: 14500,
    note: 'The default answer for anything intercontinental. Fast, and everyone knows it',
  },
  {
    id: 'global7500',
    aircraft: 'Bombardier Global 7500',
    category: 'ultra-long-range',
    seats: 14,
    rangeNm: 7700,
    cruiseKts: 516,
    hourlyRate: 15500,
    note: 'Four true cabin zones and a real bed. The only jet worth a fourteen-hour leg',
  },
  {
    id: 'bbj',
    aircraft: 'Boeing BBJ 737-700',
    category: 'ultra-long-range',
    seats: 25,
    rangeNm: 6000,
    cruiseKts: 470,
    hourlyRate: 29000,
    note: 'An airliner with a bedroom. Only defensible above twenty people',
  },
];

export const JET_INDEX: ReadonlyMap<string, JetOption> = new Map(
  JETS.map((j) => [j.id, j]),
);

// ─────────────────────────────────────────────────────────────────────────────
// Model constants — every one of these is a decision, so it is named
// ─────────────────────────────────────────────────────────────────────────────

/** Flown track vs great circle. Airways, oceanic tracks, weather deviation. */
const ROUTING_FACTOR = 1.05;

/** Taxi, climb, descent, approach. Flat per leg — it does not scale with range. */
const LEG_OVERHEAD_HOURS = 0.35;

/** Ferry hours billed across the whole trip, in and out. */
const POSITIONING_HOURS = 1.0;

/**
 * Published range is a still-air, long-range-cruise, light-payload number.
 * Real dispatch loses to reserves (alternate + 45 min), winds and a full cabin.
 * 88% is the derate a dispatcher would recognise.
 */
const RANGE_DERATE = 0.88;

/** Above this block time a third pilot is required, at ~18% on the hourly. */
const AUGMENTED_CREW_HOURS = 9;
const AUGMENTED_CREW_UPLIFT = 0.18;

/** Crew hotel and per-diem per day while the aircraft waits out the event. */
const CREW_DAY_RATE = 1400;

/** Default trip length: fly in, three nights, fly out. */
const DEFAULT_TRIP_DAYS = 3;

/** Landing + parking + FBO + navigation, per leg, by weight class. */
const HANDLING_PER_LEG: Record<JetOption['category'], number> = {
  light: 1200,
  midsize: 1500,
  'super-midsize': 2000,
  heavy: 2600,
  'ultra-long-range': 3200,
};

/** Jet-A index pass-through on the flight subtotal. */
const FUEL_ESCALATOR = 0.06;

/** US FET, used as a proxy for the equivalent burden in other jurisdictions. */
const TAX_RATE = 0.075;

/** Ground time and the extra climb/descent cycle at a fuel stop. */
const TECH_STOP_HOURS = 1.1;

// ─────────────────────────────────────────────────────────────────────────────
// Output
// ─────────────────────────────────────────────────────────────────────────────

export interface CharterBreakdown {
  /** Occupied flying, out and back. */
  occupiedHours: number;
  positioningHours: number;
  techStopHours: number;
  /** What the hours cost, after any augmented-crew uplift. */
  flightCost: number;
  crewCost: number;
  handlingCost: number;
  fuelSurcharge: number;
  taxes: number;
}

/**
 * A superset of {@link CharterQuote} — assignable anywhere a `CharterQuote` is
 * expected, with the honesty attached for anyone who wants it.
 */
export interface CharterQuoteDetail extends CharterQuote {
  /** Total flown legs including ferries and fuel stops. */
  legs: number;
  /** Fuel stops per occupied leg. 0 means nonstop. */
  techStops: number;
  /** Airframes required. >1 when the party does not fit in one cabin. */
  aircraftCount: number;
  /**
   * False when the route cannot be flown as a simple nonstop round trip by the
   * chosen airframe — the quote is then an indication for a multi-leg routing,
   * not a nonstop price. Never silently returns a nonstop number for a leg the
   * aircraft cannot fly.
   */
  nonstop: boolean;
  /** Block hours for one occupied leg, including overhead and any fuel stop. */
  legHours: number;
  breakdown: CharterBreakdown;
  /** Human-readable, for the panel footnote. */
  assumptions: string[];
}

export interface QuoteOptions {
  /** Days the aircraft is on the ground at destination. Default 3. */
  tripDays?: number;
  /**
   * Seats the quote is divided across. Defaults to `seatsNeeded`. Lets the
   * charter panel sweep "cost per seat as the group fills" without re-picking
   * the airframe on every step.
   */
  seatsFilled?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Selection
// ─────────────────────────────────────────────────────────────────────────────

/** Usable range after reserves, winds and a full cabin. */
export const usableRangeNm = (jet: JetOption): number =>
  Math.round(jet.rangeNm * RANGE_DERATE);

/**
 * Smallest airframe in the catalogue that will take the party the distance
 * nonstop. Returns `null` when nothing in the catalogue can — the caller then
 * has to decide between a fuel stop and a bigger aeroplane.
 */
export function selectJet(distanceNm: number, seatsNeeded: number): JetOption | null {
  const seats = Math.max(1, Math.ceil(seatsNeeded));
  for (const jet of JETS) {
    if (jet.seats >= seats && usableRangeNm(jet) >= distanceNm) return jet;
  }
  return null;
}

/** Every airframe that could plausibly do the job — the comparison list. */
export function candidateJets(distanceNm: number, seatsNeeded: number): JetOption[] {
  const seats = Math.max(1, Math.ceil(seatsNeeded));
  const fits = JETS.filter((j) => j.seats >= seats);
  const nonstop = fits.filter((j) => usableRangeNm(j) >= distanceNm);
  // If nothing goes nonstop, offer the longest-legged options anyway — with a
  // fuel stop, which the quote will say out loud.
  return nonstop.length > 0 ? nonstop : fits.slice(-3);
}

// ─────────────────────────────────────────────────────────────────────────────
// The quote
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Indicative round-trip charter price.
 *
 * @param from        Departure — normally the group's hub, or your home field.
 * @param to          The event's nearest jet port.
 * @param seatsNeeded Passengers to carry. Drives airframe selection.
 * @param jet         Force an airframe. Omit to take the smallest suitable one.
 * @param opts        Trip length and the seat count to divide across.
 */
export function quoteCharter(
  from: GeoPoint,
  to: GeoPoint,
  seatsNeeded: number,
  jet?: JetOption,
  opts: QuoteOptions = {},
): CharterQuoteDetail {
  const pax = Math.max(1, Math.ceil(seatsNeeded));
  const tripDays = Math.max(1, opts.tripDays ?? DEFAULT_TRIP_DAYS);
  const distanceNm = Math.round(greatCircleDistanceNm(from, to));

  // ── Airframe ───────────────────────────────────────────────────────────
  const chosen: JetOption =
    jet ??
    selectJet(distanceNm, pax) ??
    // Nothing goes nonstop with that party. Take the longest-legged airframe
    // that seats them and admit to the fuel stop below.
    [...JETS].filter((j) => j.seats >= pax).sort((a, b) => b.rangeNm - a.rangeNm)[0] ??
    JETS[JETS.length - 1]!;

  // A party bigger than the largest cabin needs more than one aeroplane. Say
  // so rather than pretending 30 people fit in a G650.
  const aircraftCount = Math.max(1, Math.ceil(pax / chosen.seats));

  // ── Time ───────────────────────────────────────────────────────────────
  const usable = usableRangeNm(chosen);
  const techStops = usable >= distanceNm ? 0 : Math.ceil(distanceNm / usable) - 1;
  const nonstop = techStops === 0;

  const cruiseHours = (distanceNm * ROUTING_FACTOR) / chosen.cruiseKts;
  const legHours = cruiseHours + LEG_OVERHEAD_HOURS + techStops * TECH_STOP_HOURS;
  const occupiedHours = legHours * 2;
  const techStopHours = techStops * TECH_STOP_HOURS * 2;
  const billableHours = occupiedHours + POSITIONING_HOURS;

  // ── Money ──────────────────────────────────────────────────────────────
  // Long legs need a third pilot to stay inside duty limits; that is a real
  // line on a real quote, not a rounding.
  const crewUplift = legHours > AUGMENTED_CREW_HOURS ? 1 + AUGMENTED_CREW_UPLIFT : 1;
  const effectiveHourly = chosen.hourlyRate * crewUplift;

  const flightCost = billableHours * effectiveHourly * aircraftCount;

  // Two occupied legs + two ferry legs, plus one landing per fuel stop each way.
  const legs = (2 + 2 + techStops * 2) * aircraftCount;
  const handlingCost = legs * HANDLING_PER_LEG[chosen.category];

  const crewCost = tripDays * CREW_DAY_RATE * aircraftCount;
  const fuelSurcharge = flightCost * FUEL_ESCALATOR;

  const subtotal = flightCost + handlingCost + crewCost + fuelSurcharge;
  const taxes = subtotal * TAX_RATE;
  const totalCost = Math.round(subtotal + taxes);

  const seatsFilled = Math.max(1, Math.min(opts.seatsFilled ?? pax, chosen.seats * aircraftCount));
  const costPerSeat = Math.round(totalCost / seatsFilled);

  const assumptions: string[] = [
    `Round trip, ${tripDays} nights on the ground`,
    `Block time from great circle +${Math.round((ROUTING_FACTOR - 1) * 100)}% routing, +${LEG_OVERHEAD_HOURS.toFixed(2)} h per leg`,
    `${POSITIONING_HOURS.toFixed(1)} h repositioning billed`,
    `Handling, crew per-diem, ${Math.round(FUEL_ESCALATOR * 100)}% fuel escalator, ${(TAX_RATE * 100).toFixed(1)}% tax`,
  ];
  if (crewUplift > 1) assumptions.push('Augmented crew — leg exceeds nine block hours');
  if (!nonstop) {
    assumptions.push(
      `${techStops} technical stop${techStops > 1 ? 's' : ''} each way — ${chosen.aircraft} usable range ${usable.toLocaleString('en-US')} nm against ${distanceNm.toLocaleString('en-US')} nm`,
    );
  }
  if (aircraftCount > 1) {
    assumptions.push(`${aircraftCount} aircraft — party exceeds a single ${chosen.aircraft} cabin`);
  }

  return {
    jet: chosen,
    distanceNm,
    flightHours: round2(occupiedHours),
    totalCost,
    costPerSeat,
    seatsFilled,
    legs,
    techStops,
    aircraftCount,
    nonstop,
    legHours: round2(legHours),
    breakdown: {
      occupiedHours: round2(occupiedHours),
      positioningHours: POSITIONING_HOURS,
      techStopHours: round2(techStopHours),
      flightCost: Math.round(flightCost),
      crewCost: Math.round(crewCost),
      handlingCost: Math.round(handlingCost),
      fuelSurcharge: Math.round(fuelSurcharge),
      taxes: Math.round(taxes),
    },
    assumptions,
  };
}

/**
 * The core economic argument of the product, as a table: what the same aircraft
 * costs each, as the cabin fills. The airframe is chosen once for the *full*
 * party so the comparison is honest — the marginal passenger is free, which is
 * exactly the point.
 */
export function costCurve(
  from: GeoPoint,
  to: GeoPoint,
  capacity: number,
  jet?: JetOption,
  opts: QuoteOptions = {},
): Array<{ seats: number; perSeat: number; total: number }> {
  const base = quoteCharter(from, to, capacity, jet, opts);
  const max = Math.min(capacity, base.jet.seats * base.aircraftCount);
  const out: Array<{ seats: number; perSeat: number; total: number }> = [];
  for (let n = 1; n <= max; n++) {
    out.push({
      seats: n,
      perSeat: Math.round(base.totalCost / n),
      total: base.totalCost,
    });
  }
  return out;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** `$118,400`. No cents — nobody quotes charter to the dollar. */
export const formatUsd = (n: number): string =>
  `$${Math.round(n).toLocaleString('en-US')}`;

/** `8h 10m`. */
export function formatHours(h: number): string {
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  if (mins === 60) return `${whole + 1}h 00m`;
  return `${whole}h ${String(mins).padStart(2, '0')}m`;
}
