/**
 * MERIDIAN — Amadeus adapter (hotel scarcity).
 *
 * ── Endpoints ────────────────────────────────────────────────────────────────
 * 1. Token (OAuth2 client credentials, ~30 min lifetime):
 *      POST https://api.amadeus.com/v1/security/oauth2/token
 *      Content-Type: application/x-www-form-urlencoded
 *      body: grant_type=client_credentials
 *           &client_id=$AMADEUS_CLIENT_ID
 *           &client_secret=$AMADEUS_CLIENT_SECRET
 *      → { access_token, expires_in, token_type: "Bearer" }
 *
 * 2. Hotel inventory in the destination:
 *      GET https://api.amadeus.com/v1/reference-data/locations/hotels/by-geocode
 *          ?latitude={lat}&longitude={lon}&radius=20&radiusUnit=KM
 *          &ratings=4,5&hotelSource=ALL
 *      Auth: Authorization: Bearer {access_token}
 *
 * 3. Live availability for those hotels on the event dates:
 *      GET https://api.amadeus.com/v3/shopping/hotel-offers
 *          ?hotelIds={csv, ≤ 50}&checkInDate={start}&checkOutDate={end+1}
 *          &adults=2&roomQuantity=1&bestRateOnly=true
 *      Auth: Authorization: Bearer {access_token}
 *      → data[]  — one entry per hotel that still has an offer. Hotels with no
 *                  availability are simply absent from the response.
 *
 *   Docs: developers.amadeus.com/self-service/category/hotels
 *
 * ── Mapping ──────────────────────────────────────────────────────────────────
 *   1 − (hotels with offers / hotels in the area)   → bookingPressure
 *   median offer price vs. the same hotels' floor   → bookingPressure (blended)
 *
 * This is the closest thing to a hard demand signal in the whole system: it is
 * inventory that has actually been sold. Which is precisely why it gets the
 * highest merge precedence for `bookingPressure` (see sources.ts).
 *
 * ── Notes ────────────────────────────────────────────────────────────────────
 * • Ratings are filtered to 4–5 star. Our members are not competing for the
 *   budget inventory, and including it dilutes the scarcity signal badly —
 *   during Art Basel the Beau-Rivage is gone months out while the airport
 *   Ibis is not, and averaging the two hides the entire story.
 * • `checkOutDate` is `end + 1` because Amadeus checkout is exclusive while
 *   `WorldEvent.end` is inclusive.
 * • The token is cached in module scope for its full lifetime minus a 60s skew
 *   margin. Requesting a token per event would exhaust the rate limit instantly.
 * • Multi-week events are clamped to a 7-night query — Amadeus rejects very
 *   long stays and a week is representative of the squeeze either way.
 */

import type { BuzzSignals, EventSource, SourceHealth, WorldEvent } from '@/lib/types';
import { addDays, daysBetween } from '@/lib/buzz/dates';
import { HealthTracker, env, getJSON, mapLimit, mergePatch } from './http';

const HOST = 'https://api.amadeus.com';
const RADIUS_KM = 20;
const MAX_HOTEL_IDS = 50;
const MAX_NIGHTS = 7;
const CONCURRENCY = 2;

const tracker = new HealthTracker('amadeus', 'Amadeus hotel availability', [
  'AMADEUS_CLIENT_ID',
  'AMADEUS_CLIENT_SECRET',
]);

// ── Token cache ──────────────────────────────────────────────────────────────

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const id = env('AMADEUS_CLIENT_ID');
  const secret = env('AMADEUS_CLIENT_SECRET');
  if (!id || !secret) throw new Error('Amadeus credentials absent');

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: id,
    client_secret: secret,
  });

  const res = await getJSON<{ access_token: string; expires_in: number }>(
    `${HOST}/v1/security/oauth2/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
  );

  cachedToken = {
    value: res.access_token,
    expiresAt: Date.now() + Math.max(0, (res.expires_in ?? 1800) - 60) * 1000,
  };
  return cachedToken.value;
}

// ── Response shapes ──────────────────────────────────────────────────────────

interface HotelListResponse {
  data?: { hotelId?: string; name?: string; rating?: string }[];
}

interface HotelOffersResponse {
  data?: {
    hotel?: { hotelId?: string };
    available?: boolean;
    offers?: { price?: { total?: string; currency?: string } }[];
  }[];
}

// ── Per-event fetch ──────────────────────────────────────────────────────────

async function fetchOne(event: WorldEvent): Promise<Partial<BuzzSignals> | null> {
  const token = await getToken();
  const auth = { Authorization: `Bearer ${token}` };

  const listParams = new URLSearchParams({
    latitude: event.coords.lat.toFixed(4),
    longitude: event.coords.lon.toFixed(4),
    radius: String(RADIUS_KM),
    radiusUnit: 'KM',
    ratings: '4,5',
    hotelSource: 'ALL',
  });

  const list = await getJSON<HotelListResponse>(
    `${HOST}/v1/reference-data/locations/hotels/by-geocode?${listParams}`,
    { headers: auth },
  );

  const hotelIds = (list.data ?? [])
    .map((h) => h.hotelId)
    .filter((h): h is string => !!h)
    .slice(0, MAX_HOTEL_IDS);

  // Fewer than 4 upmarket hotels in a 20km radius means the ratio below is
  // statistical noise. Better to emit nothing and keep the curated baseline.
  if (hotelIds.length < 4) return null;

  const nights = Math.min(MAX_NIGHTS, Math.max(1, daysBetween(event.start, event.end) + 1));
  const offerParams = new URLSearchParams({
    hotelIds: hotelIds.join(','),
    checkInDate: event.start,
    checkOutDate: addDays(event.start, nights),
    adults: '2',
    roomQuantity: '1',
    bestRateOnly: 'true',
  });

  const offers = await getJSON<HotelOffersResponse>(
    `${HOST}/v3/shopping/hotel-offers?${offerParams}`,
    { headers: auth },
  );

  const availableHotels = new Set(
    (offers.data ?? [])
      .filter((d) => d.available !== false && (d.offers?.length ?? 0) > 0)
      .map((d) => d.hotel?.hotelId)
      .filter((h): h is string => !!h),
  );

  // Sold-out ratio: the headline scarcity number.
  const soldOut = 1 - availableHotels.size / hotelIds.length;

  // Price stress: how far the cheapest surviving rooms sit above the cheapest
  // room in the set. A wide spread means the affordable inventory has gone.
  const prices = (offers.data ?? [])
    .flatMap((d) => d.offers ?? [])
    .map((o) => Number.parseFloat(o.price?.total ?? ''))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  let priceStress = 0;
  if (prices.length >= 4) {
    const median = prices[Math.floor(prices.length / 2)];
    const floor = prices[0];
    if (floor > 0) {
      // A median at 3× the floor is treated as fully stressed.
      priceStress = Math.max(0, Math.min(1, (median / floor - 1) / 2));
    }
  }

  const bookingPressure = Math.max(0, Math.min(1, 0.75 * soldOut + 0.25 * priceStress));
  return { bookingPressure };
}

export const amadeusSource: EventSource = {
  id: 'amadeus',
  label: 'Amadeus hotel availability',
  isConfigured: () => tracker.isConfigured(),

  async fetchSignals(events: WorldEvent[]): Promise<Map<string, Partial<BuzzSignals>>> {
    const out = new Map<string, Partial<BuzzSignals>>();
    if (!tracker.isConfigured()) return out;

    try {
      // One token for the whole sweep; fails fast if the credentials are wrong.
      await getToken();

      let matched = 0;
      let firstError: unknown = null;

      await mapLimit(events, CONCURRENCY, async (event) => {
        try {
          const patch = await fetchOne(event);
          if (patch) {
            mergePatch(out, event.id, patch);
            matched++;
          }
        } catch (err) {
          if (!firstError) firstError = err;
        }
      });

      if (matched === 0 && firstError) throw firstError;
      tracker.markSuccess(`${matched}/${events.length} destinations priced`);
    } catch (err) {
      tracker.markError(err);
      cachedToken = null;
      out.clear();
    }
    return out;
  },

  health: (): SourceHealth => tracker.health(),
};
