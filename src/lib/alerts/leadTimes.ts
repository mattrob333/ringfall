import { type EventCategory, type WorldEvent } from '@/lib/types';

/**
 * MERIDIAN — booking lead times.
 *
 * ── WHAT THIS NUMBER IS ─────────────────────────────────────────────────────
 *
 * `CATEGORY_LEAD_DAYS[category]` is the number of days before an event's
 * `start` by which a member must have *committed* in order to get the **good**
 * version of that trip. The chalet rather than the hotel. The terrace rather
 * than the grandstand. The camp on the river rather than two hours from it.
 *
 * It is a measure of when the **scarce, non-scalable** part of the trip is
 * gone. That part is almost never the ticket. It is eight beds on the Sabi
 * Sand, a table in the Kufflers Weinzelt, a Debenture on Centre Court, a berth
 * in Port Hercule, one of ninety-six gorilla permits, a cabin on a ship that
 * carries a hundred people to a continent with no hotels.
 *
 * The right mental model is a market that cannot add supply. Adding a stand at
 * a Grand Prix is easy; adding a balcony overlooking the Piazza del Campo is
 * not, because the balconies belong to families who have owned them for four
 * hundred years. This number tracks the second kind of thing.
 *
 * ── WHAT THIS NUMBER IS EXPLICITLY *NOT* ────────────────────────────────────
 *
 * Do not use it, and do not let UI copy imply it, as any of the following:
 *
 *   ✗ A ticket on-sale date. General admission for most of these events opens
 *     later, stays open longer, and is beside the point. Coachella GA is on
 *     sale for months; the house in Palm Springs went last October.
 *   ✗ A sell-out date. Plenty of these events never "sell out" at all — you
 *     can walk up to Alba and buy a truffle. You cannot walk up and get a
 *     paddle at the auction.
 *   ✗ A charter or flight-booking deadline. Aircraft availability is its own
 *     curve, generally much shorter, and belongs to the charter module.
 *   ✗ A refund, deposit, or cancellation cut-off. Nothing here is contractual.
 *   ✗ A price forecast. Late booking usually costs more, but this number is
 *     about *availability at any price* — the failure mode it describes is
 *     "there is none", not "it got expensive".
 *   ✗ A guarantee. It is a calibrated default for a whole category, meant to
 *     drive an alert early enough to be useful, not a promise of inventory.
 *
 * ── AN IMPORTANT INVERSION ──────────────────────────────────────────────────
 *
 * `culinary` is by far the shortest number here (30 days) and that is *not*
 * because culinary trips are easy. It is because the gate opens late and shuts
 * instantly: a three-star reservation line opens at a fixed horizon — typically
 * thirty days, sometimes to the minute — and clears in seconds. Committing
 * earlier is not possible; committing later is not possible either. Short lead
 * time here means "a very narrow window", not "low scarcity". Any UI that sorts
 * or colours by this number must not present a small value as reassurance.
 *
 * ── HOW IT IS APPLIED ───────────────────────────────────────────────────────
 *
 * These are *category defaults*. Individual events routinely deviate by a
 * factor of two in either direction, and those are expressed per event via the
 * optional `WorldEvent.bookingLeadDays` — Monaco is not the average Grand Prix,
 * Bayreuth is not the average concert. Always resolve through `leadDaysFor()`
 * so the override is honoured; never read `CATEGORY_LEAD_DAYS` directly at a
 * call site that has a `WorldEvent` in hand.
 *
 * `CATEGORY_LEAD_DAYS` is typed as an exhaustive `Record<EventCategory, …>`:
 * adding a member to `EVENT_CATEGORIES` will fail the build here until a
 * number and a note have both been chosen deliberately. That is intentional.
 * Do not silence it with a spread, an index signature, or a `Partial<>`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Days before `start` by which the scarce part of the trip is gone.
 *
 * Ordered longest to shortest so the shape of the model is legible at a glance.
 * The spread is deliberate and roughly eleven-fold: these markets clear on
 * genuinely different clocks, and flattening them would destroy the feature.
 */
export const CATEGORY_LEAD_DAYS: Record<EventCategory, number> = {
  /** 11 months. Peak-season river camps and the top Sabi Sand lodges are
   *  rebooked by returning guests as they check out; agents work 12–18 months
   *  ahead as a matter of routine. Nothing about this is negotiable — the good
   *  properties are six to twelve beds and there will never be more. */
  safari: 330,

  /** 10 months. Antarctic berths sell 12–24 months out and the good cabins go
   *  first; gorilla permits are capped at a fixed number per day; migrations
   *  and blooms are one-to-three-week windows that cannot be moved. */
  nature: 300,

  /** 10 months. The Masters practice-round ballot opens and closes in June for
   *  the following April, series badges have been closed since 1978, Ryder Cup
   *  hospitality goes on sale 12–18 months out, and Augusta-area houses are
   *  contracted a year ahead. A different market from ordinary sport. */
  golf: 300,

  /** 8 months. Christmas and New Year chalets in Courchevel 1850, Gstaad and
   *  St. Moritz are re-let to last season's family before the lifts even open;
   *  what reaches the open market clears by late spring. February half-term is
   *  shorter, roughly five months, and pulls the category average down. */
  ski: 240,

  /** 8 months. Debentures are tradeable securities, not tickets, and the
   *  Wimbledon public ballot closes the autumn before the Championships.
   *  Village houses and the clubhouse side of the fortnight go earlier still. */
  tennis: 240,

  /** 7 months. Palio window seats belong to Sienese families and are spoken
   *  for by the previous winter; Oktoberfest tents open their books in waves
   *  from January to May for late September; Carnival at the Copacabana Palace
   *  is a year. The event is free to attend and impossible to attend well. */
  cultural: 210,

  /** 7 months. Cannes, Telluride, Park City and the Lido are small towns with
   *  fixed bed counts, and the rooms are contracted before the line-up is
   *  announced. Accreditation is the easy half of the problem. */
  film: 210,

  /** 7 months. The Vienna Opera Ball ballot registers eight months out and
   *  boxes carry a right of first refusal for major donors; the tables that
   *  matter at amfAR or Save Venice are held by last year's hosts. Where the
   *  invitation cannot be bought at all, treat this as the relationship clock. */
  gala: 210,

  /** 7 months. A specific hull for a specific week: the charter fleet for the
   *  Mediterranean season is committed before it opens, and Porto Cervo,
   *  Saint-Tropez and Monaco berths are allocated, not sold. */
  sailing: 210,

  /** 6 months. The Royal Enclosure needs an existing badge-holder to sponsor
   *  you and a winter application window; Derby and Melbourne Cup boxes are
   *  renewed annually by the people already in them. */
  equestrian: 180,

  /** 6 months. Festival subscription windows and lotteries — Salzburg,
   *  Glyndebourne, Bayreuth, Glastonbury — open on a published date and clear
   *  in a single morning, and there is no second bite. */
  music: 180,

  /** 6 months. The serious clinics run *intakes*, not bookings: a fixed number
   *  of beds, a fixed programme length, a medical pre-screen, and a genuine
   *  waitlist. January at Lanserhof is full by midsummer. */
  wellness: 180,

  /** 5 months. The fair is the easy part — a VIP card comes through a gallery.
   *  Basel, Maastricht and Venice simply do not have enough beds, and the
   *  Trois Rois is rebooked at checkout for the following June. */
  art: 150,

  /** 5 months. Monaco terraces and Port Hercule berths, Goodwood hospitality,
   *  the Pebble Beach houses for Car Week: the view is finite even though the
   *  grandstand is not. Monaco itself runs far longer — override it. */
  motorsport: 150,

  /** 4 months. Salone puts three hundred thousand people into Milan for one
   *  week and the city's rooms clear long before the stands go up. London,
   *  Miami and Dubai have real hotel inventory and pull the average down. */
  design: 120,

  /** 3 months. The seat itself cannot be bought at any price or any horizon —
   *  it arrives by invitation a fortnight out — so this number describes the
   *  part that *is* purchasable: the Paris or Milan room, and the car and
   *  driver, both of which are gone by the three-month mark. */
  fashion: 90,

  /** 1 month. See the inversion note in the file header: this is short because
   *  the reservation line for a three-star opens at a fixed ~30-day horizon and
   *  clears in seconds, not because the table is easy. Earlier is impossible;
   *  later is too late. Harvest-bound trips (truffle, vendange) sit at the same
   *  horizon for a different reason — the date itself is not known much sooner. */
  culinary: 30,
};

// ─────────────────────────────────────────────────────────────────────────────
// Notes — one line of *why*, surfaced next to the number in the UI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single line of justification per category, written to be read by a member
 * rather than by an analyst. Each answers "why that number?" concretely, by
 * naming the thing that runs out. Keep them one sentence and specific; a vague
 * note is worse than none, because it reads as a disclaimer.
 */
export const LEAD_TIME_NOTES: Record<EventCategory, string> = {
  safari:
    'The six-bed camps on the river and the best Sabi Sand lodges are rebooked by returning guests as they check out.',
  nature:
    'Antarctic berths, permits capped by daily quota, and migration windows measured in weeks — all rationed a year ahead.',
  golf: 'The Masters ballot opens and closes ten months out, and Ryder Cup hospitality is sold before the team is known.',
  ski: 'The chalets that matter for New Year are re-let to last season’s family before the snow arrives.',
  tennis:
    'Debentures trade as securities rather than tickets, and the Wimbledon ballot closes the autumn before.',
  cultural:
    'Palio window seats belong to Sienese families, and the good Oktoberfest tents open their books in spring.',
  film: 'Cannes, Telluride and the Lido are small towns; the rooms are contracted before the line-up is announced.',
  gala: 'The Opera Ball ballot registers eight months out, and the tables that matter are held by last year’s hosts.',
  sailing:
    'A specific hull for a specific week — the charter fleet and the Mediterranean berths are committed before the season opens.',
  equestrian:
    'The Royal Enclosure needs a sponsor and a winter application; the boxes are renewed by the people already in them.',
  music:
    'Salzburg, Glyndebourne, Bayreuth and Glastonbury open on a published date and clear in a single morning.',
  wellness:
    'The clinics that work run intakes rather than bookings, and January is full by midsummer.',
  art: 'The fair is the easy part — Basel, Maastricht and Venice do not have enough beds, and never will.',
  motorsport:
    'Monaco terraces, Port Hercule berths and Goodwood hospitality: the view is finite even where the grandstand is not.',
  design:
    'Salone puts three hundred thousand people into Milan for one week, and the city clears long before the stands go up.',
  fashion:
    'The seat cannot be bought at any horizon; the Paris hotel room and the car and driver can, but not late.',
  culinary:
    'Inverted — the three-star line opens about thirty days out and clears in seconds. Earlier is impossible, later is too late.',
};

// ─────────────────────────────────────────────────────────────────────────────
// Resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The lead time to use for a specific event: its own `bookingLeadDays` when the
 * curated dataset has an opinion, otherwise the category default.
 *
 * A curated `0` is meaningful — it says "walk up, this one is genuinely open" —
 * so it is honoured rather than treated as absent. Values that could not have
 * been intended (negative, NaN, Infinity) fall through to the category default
 * instead of poisoning downstream date arithmetic; live adapters populate this
 * field and are not as careful as the curated set.
 *
 * Always prefer this over reading `CATEGORY_LEAD_DAYS` directly.
 */
export function leadDaysFor(event: WorldEvent): number {
  const override = event.bookingLeadDays;

  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) {
    return override;
  }

  return CATEGORY_LEAD_DAYS[event.category];
}
