# MERIDIAN

**Private travel intelligence.** A live index of where the world is worth being,
rendered as an obsidian planet you scrub through time.

Slide the scrubber to three weeks out and the globe shows you what is burning
that week — festivals, races, regattas, powder, openings, the closed rooms.
Mark interest, see which other members are circling the same week, and once a
group forms the charter maths turns a $140,000 aeroplane into $17,500 a seat.

---

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

Use `localhost`, not `127.0.0.1` — Next 16 blocks cross-origin dev asset
requests, and a mismatched host silently prevents the globe's chunk from
loading.

```bash
npm run build && npm start   # production
npm run gate                 # typecheck + dataset validation + build
```

Requires Node ≥ 22.12. There are no API keys to configure and no backend to
stand up; it runs fully offline.

---

## What it's made of

| Layer | Path | What it does |
|---|---|---|
| Domain contract | `src/lib/types.ts` | Frozen. Every subsystem shares it. |
| Globe | `src/components/globe`, `src/lib/geo` | Vector Earth, beacons, camera |
| Dataset | `src/lib/data/events` | 241 real events, 170 real jet ports |
| Buzz engine | `src/lib/buzz`, `src/lib/selectors` | Scoring, relevance, the bridge |
| Feeds | `src/lib/data/adapters`, `src/app/api` | Live signal adapters |
| Interface | `src/components/{ui,chrome,timeline,panels}` | Design system, scrubber, dossier |
| Social | `src/lib/social`, `src/components/social` | Members, groups, charter maths |

### The globe is vector, not textured

There is no satellite imagery anywhere in this repo. Country geometry is real
Natural Earth data, baked to GeoJSON at setup (`npm run geo:build`) and
triangulated onto the sphere at runtime. That avoids the licensing and payload
cost of imagery, renders identically offline, and frankly suits the product
better — an obsidian planet with cities burning on it reads better than a photo
of Earth with pins stuck in it.

Two things that were harder than they look, both fixed and both commented in
`src/lib/geo/geojson.ts`: Natural Earth rings that cross the antimeridian
triangulate into a garbage band across the Pacific unless longitudes are
unwrapped first, and earcut happily runs a 37° diagonal across Antarctica that
sags well below the sphere's surface unless the triangulation is refined.

### The scoring model

`src/lib/buzz/scoring.ts` turns six demand signals into a 0–100 score. Weights
sum to 1.0, the weighted components sum to the score as an enforced invariant,
and heavy-tailed signals use a floored log — a plain log compresses 1k and 10k
mentions to nearly the same value, solving the outlier problem by destroying
all discrimination.

Measured across the real dataset: supernova 4.6%, blazing 10.4%, hot 19.9%,
warm 29.5%, smoldering 35.7%. The thresholds were fitted to produce that
distribution, not guessed.

**Buzz is evaluated at the scrubber's position, not at today.** This matters.
Monaco GP has the strongest intrinsic signal profile of all 241 events, but
anchored to today it sits at rank 131 because it is 313 days out — so scrubbing
to its weekend would show a dim beacon, which is a broken product. Scoring at
the focus date means proximity still applies in full within every pass, the
opening view is unchanged, and Monaco is rank 1 when you go looking for it.

### Live data is a switch, not a rewrite

Adapters for PredictHQ, Ticketmaster, X, Google Trends (via SerpAPI) and
Amadeus are written against their real endpoints and live in
`src/lib/data/adapters`. Each reports `unconfigured` until its key exists, and
the Sources panel shows the state of all six. Add a key to `.env.local`
(see `.env.example`) and that adapter starts sharpening the curated baselines
on the next sync — no code change.

Keys are read server-side only, in `src/app/api`. They never reach the browser.

---

## Honest limitations

- **Live adapters are structurally verified, not exercised.** Their URLs, auth
  shapes and failure handling are correct — a bogus X token was confirmed to
  produce a 403, degrade to `status: 'error'`, and leave the app serving. But
  with no real keys, response *parsing* has never run against a real payload.
  Expect to fix field mappings the day you add credentials.
- **Members are simulated.** Local-first was a deliberate choice, so the 80
  members, 2,557 interest signals and 122 groups are generated deterministically
  from a seed. Real multi-user presence needs a backend.
- **~40% of 2027 dates are established windows, not published dates.** Many 2027
  schedules aren't out yet. Where a date is inferred it follows the event's
  reliable rule (Wimbledon opens the Monday nearest 28 June). The weakest are
  noted in the agent report; La Liste and San Sebastián Gastronomika are the
  softest.
- **Charter quotes are a model, not a broker.** Short-haul European legs land
  inside the real band; the ultra-long-range routes sit at the top of it and are
  likely 20–30% high. Assumptions are documented in `src/lib/social/charter.ts`.
- **Coordinates are verified by bounding box, not survey.** All 241 sit inside
  their declared country; 178 were additionally checked against a hand-verified
  city gazetteer at 75km tolerance. The remainder are remote or seasonal
  locations where a city centroid doesn't apply.
- **Desktop only.** Laid out for ≥1280px and degrades to ~900px by measurement.
  There is no phone layout.
