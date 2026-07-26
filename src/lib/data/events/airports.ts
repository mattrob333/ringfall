/**
 * MERIDIAN — shared private-aviation gateway registry.
 *
 * Every record is a real field with a real ICAO identifier and real
 * coordinates (WGS84, ~4dp). Selection bias is deliberate: these are the
 * airports a Global 7500 actually files to, which is frequently *not* the
 * region's main commercial field. Where a dedicated executive airport exists
 * alongside a hub — Le Bourget vs. CDG, Teterboro vs. JFK, Al Bateen vs.
 * Abu Dhabi International — the executive field is the one listed.
 *
 * `fboQuality`:
 *   exceptional — multiple competing FBOs, customs on demand, heavy-jet apron,
 *                 no slot anxiety even in event weeks
 *   excellent   — proper FBO, reliable handling, occasional peak-week pressure
 *   adequate    — it works, but expect a short runway, a single handler,
 *                 daylight-only ops, or a long drive at the far end
 *
 * Export names are ICAO identifiers so they cannot silently collide.
 */

import type { Airport } from '@/lib/types';

// ─────────────────────────────────────────────────────────────────────────────
// France / Monaco
// ─────────────────────────────────────────────────────────────────────────────

export const LFMD: Airport = {
  code: 'LFMD',
  name: 'Cannes–Mandelieu',
  coords: { lat: 43.542, lon: 6.9535 },
  fboQuality: 'exceptional',
};

export const LFMN: Airport = {
  code: 'LFMN',
  name: 'Nice Côte d’Azur',
  coords: { lat: 43.6584, lon: 7.2159 },
  fboQuality: 'exceptional',
};

export const LFTZ: Airport = {
  code: 'LFTZ',
  name: 'La Môle – Saint-Tropez',
  coords: { lat: 43.2054, lon: 6.482 },
  fboQuality: 'adequate',
};

export const LFPB: Airport = {
  code: 'LFPB',
  name: 'Paris–Le Bourget',
  coords: { lat: 48.9694, lon: 2.4414 },
  fboQuality: 'exceptional',
};

export const LFRM: Airport = {
  code: 'LFRM',
  name: 'Le Mans–Arnage',
  coords: { lat: 47.9486, lon: 0.2017 },
  fboQuality: 'adequate',
};

export const LFLL: Airport = {
  code: 'LFLL',
  name: 'Lyon–Saint-Exupéry',
  coords: { lat: 45.7256, lon: 5.0811 },
  fboQuality: 'excellent',
};

export const LFBD: Airport = {
  code: 'LFBD',
  name: 'Bordeaux–Mérignac',
  coords: { lat: 44.8283, lon: -0.7156 },
  fboQuality: 'excellent',
};

export const LFMV: Airport = {
  code: 'LFMV',
  name: 'Avignon–Provence',
  coords: { lat: 43.9073, lon: 4.9018 },
  fboQuality: 'adequate',
};

export const LFKB: Airport = {
  code: 'LFKB',
  name: 'Bastia–Poretta',
  coords: { lat: 42.5527, lon: 9.4837 },
  fboQuality: 'adequate',
};

export const LFLB: Airport = {
  code: 'LFLB',
  name: 'Chambéry–Savoie',
  coords: { lat: 45.638, lon: 5.8801 },
  fboQuality: 'adequate',
};

export const LFLJ: Airport = {
  code: 'LFLJ',
  name: 'Courchevel Altiport',
  coords: { lat: 45.3967, lon: 6.6347 },
  fboQuality: 'adequate',
};

// ─────────────────────────────────────────────────────────────────────────────
// Switzerland / Austria / Germany
// ─────────────────────────────────────────────────────────────────────────────

export const LSGG: Airport = {
  code: 'LSGG',
  name: 'Geneva',
  coords: { lat: 46.2381, lon: 6.1089 },
  fboQuality: 'exceptional',
};

export const LSZH: Airport = {
  code: 'LSZH',
  name: 'Zurich',
  coords: { lat: 47.4647, lon: 8.5492 },
  fboQuality: 'excellent',
};

export const LSGS: Airport = {
  code: 'LSGS',
  name: 'Sion',
  coords: { lat: 46.2196, lon: 7.3268 },
  fboQuality: 'excellent',
};

export const LSZS: Airport = {
  code: 'LSZS',
  name: 'Samedan / Engadin',
  coords: { lat: 46.5341, lon: 9.8841 },
  fboQuality: 'excellent',
};

export const LSGK: Airport = {
  code: 'LSGK',
  name: 'Saanen (Gstaad)',
  coords: { lat: 46.4875, lon: 7.2511 },
  fboQuality: 'adequate',
};

export const LSZA: Airport = {
  code: 'LSZA',
  name: 'Lugano',
  coords: { lat: 46.0043, lon: 8.9106 },
  fboQuality: 'adequate',
};

export const LFSB: Airport = {
  code: 'LFSB',
  name: 'EuroAirport Basel–Mulhouse',
  coords: { lat: 47.5896, lon: 7.5299 },
  fboQuality: 'excellent',
};

export const LSZB: Airport = {
  code: 'LSZB',
  name: 'Bern–Belp',
  coords: { lat: 46.9141, lon: 7.4971 },
  fboQuality: 'adequate',
};

export const LOWI: Airport = {
  code: 'LOWI',
  name: 'Innsbruck',
  coords: { lat: 47.2602, lon: 11.3439 },
  fboQuality: 'excellent',
};

export const LOWS: Airport = {
  code: 'LOWS',
  name: 'Salzburg W. A. Mozart',
  coords: { lat: 47.7933, lon: 13.0043 },
  fboQuality: 'excellent',
};

export const LOWW: Airport = {
  code: 'LOWW',
  name: 'Vienna–Schwechat',
  coords: { lat: 48.1103, lon: 16.5697 },
  fboQuality: 'excellent',
};

export const EDMO: Airport = {
  code: 'EDMO',
  name: 'Oberpfaffenhofen (Munich)',
  coords: { lat: 48.0814, lon: 11.2831 },
  fboQuality: 'excellent',
};

export const EDDM: Airport = {
  code: 'EDDM',
  name: 'Munich Franz Josef Strauss',
  coords: { lat: 48.3538, lon: 11.7861 },
  fboQuality: 'excellent',
};

export const EDDN: Airport = {
  code: 'EDDN',
  name: 'Nuremberg',
  coords: { lat: 49.4987, lon: 11.0781 },
  fboQuality: 'excellent',
};

export const EDDB: Airport = {
  code: 'EDDB',
  name: 'Berlin Brandenburg',
  coords: { lat: 52.3667, lon: 13.5033 },
  fboQuality: 'excellent',
};

// ─────────────────────────────────────────────────────────────────────────────
// United Kingdom / Ireland
// ─────────────────────────────────────────────────────────────────────────────

export const EGLF: Airport = {
  code: 'EGLF',
  name: 'Farnborough',
  coords: { lat: 51.2758, lon: -0.7763 },
  fboQuality: 'exceptional',
};

export const EGGW: Airport = {
  code: 'EGGW',
  name: 'London Luton',
  coords: { lat: 51.8747, lon: -0.3683 },
  fboQuality: 'excellent',
};

export const EGKB: Airport = {
  code: 'EGKB',
  name: 'London Biggin Hill',
  coords: { lat: 51.3308, lon: 0.0325 },
  fboQuality: 'excellent',
};

export const EGHR: Airport = {
  code: 'EGHR',
  name: 'Chichester / Goodwood',
  coords: { lat: 50.8592, lon: -0.7592 },
  fboQuality: 'adequate',
};

export const EGHI: Airport = {
  code: 'EGHI',
  name: 'Southampton',
  coords: { lat: 50.9503, lon: -1.3568 },
  fboQuality: 'adequate',
};

export const EGPH: Airport = {
  code: 'EGPH',
  name: 'Edinburgh',
  coords: { lat: 55.95, lon: -3.3725 },
  fboQuality: 'excellent',
};

export const EGPN: Airport = {
  code: 'EGPN',
  name: 'Dundee (St Andrews)',
  coords: { lat: 56.4525, lon: -3.0258 },
  fboQuality: 'adequate',
};

export const EGPF: Airport = {
  code: 'EGPF',
  name: 'Glasgow',
  coords: { lat: 55.8719, lon: -4.4331 },
  fboQuality: 'excellent',
};

export const EINN: Airport = {
  code: 'EINN',
  name: 'Shannon',
  coords: { lat: 52.702, lon: -8.9248 },
  fboQuality: 'excellent',
};

export const EIDW: Airport = {
  code: 'EIDW',
  name: 'Dublin',
  coords: { lat: 53.4213, lon: -6.2701 },
  fboQuality: 'excellent',
};

// ─────────────────────────────────────────────────────────────────────────────
// Italy / Iberia / Mediterranean
// ─────────────────────────────────────────────────────────────────────────────

export const LIML: Airport = {
  code: 'LIML',
  name: 'Milan Linate',
  coords: { lat: 45.4451, lon: 9.2767 },
  fboQuality: 'excellent',
};

export const LIRA: Airport = {
  code: 'LIRA',
  name: 'Rome Ciampino',
  coords: { lat: 41.7994, lon: 12.5949 },
  fboQuality: 'excellent',
};

export const LIPZ: Airport = {
  code: 'LIPZ',
  name: 'Venice Marco Polo',
  coords: { lat: 45.5053, lon: 12.3519 },
  fboQuality: 'excellent',
};

export const LIRN: Airport = {
  code: 'LIRN',
  name: 'Naples Capodichino',
  coords: { lat: 40.886, lon: 14.2908 },
  fboQuality: 'excellent',
};

export const LIRQ: Airport = {
  code: 'LIRQ',
  name: 'Florence Peretola',
  coords: { lat: 43.81, lon: 11.2051 },
  fboQuality: 'adequate',
};

export const LIQS: Airport = {
  code: 'LIQS',
  name: 'Siena Ampugnano',
  coords: { lat: 43.2563, lon: 11.255 },
  fboQuality: 'adequate',
};

export const LIEO: Airport = {
  code: 'LIEO',
  name: 'Olbia Costa Smeralda',
  coords: { lat: 40.8987, lon: 9.5176 },
  fboQuality: 'excellent',
};

export const LIMF: Airport = {
  code: 'LIMF',
  name: 'Turin Caselle',
  coords: { lat: 45.2008, lon: 7.6497 },
  fboQuality: 'adequate',
};

export const LICJ: Airport = {
  code: 'LICJ',
  name: 'Palermo Falcone–Borsellino',
  coords: { lat: 38.1759, lon: 13.091 },
  fboQuality: 'adequate',
};

export const LIRI: Airport = {
  code: 'LIRI',
  name: 'Salerno Costa d’Amalfi',
  coords: { lat: 40.6204, lon: 14.9113 },
  fboQuality: 'adequate',
};

export const LEZL: Airport = {
  code: 'LEZL',
  name: 'Seville',
  coords: { lat: 37.418, lon: -5.8931 },
  fboQuality: 'adequate',
};

export const LEMG: Airport = {
  code: 'LEMG',
  name: 'Málaga–Costa del Sol',
  coords: { lat: 36.6749, lon: -4.4991 },
  fboQuality: 'excellent',
};

export const LEIB: Airport = {
  code: 'LEIB',
  name: 'Ibiza',
  coords: { lat: 38.8729, lon: 1.3731 },
  fboQuality: 'excellent',
};

export const LEPA: Airport = {
  code: 'LEPA',
  name: 'Palma de Mallorca',
  coords: { lat: 39.5517, lon: 2.7388 },
  fboQuality: 'excellent',
};

export const LEVC: Airport = {
  code: 'LEVC',
  name: 'Valencia',
  coords: { lat: 39.4893, lon: -0.4816 },
  fboQuality: 'adequate',
};

export const LECU: Airport = {
  code: 'LECU',
  name: 'Madrid Cuatro Vientos',
  coords: { lat: 40.3706, lon: -3.7851 },
  fboQuality: 'excellent',
};

export const LPCS: Airport = {
  code: 'LPCS',
  name: 'Cascais (Lisbon)',
  coords: { lat: 38.7248, lon: -9.3553 },
  fboQuality: 'excellent',
};

export const LPFR: Airport = {
  code: 'LPFR',
  name: 'Faro',
  coords: { lat: 37.0144, lon: -7.9659 },
  fboQuality: 'adequate',
};

export const LMML: Airport = {
  code: 'LMML',
  name: 'Malta Luqa',
  coords: { lat: 35.8575, lon: 14.4775 },
  fboQuality: 'excellent',
};

export const LGAV: Airport = {
  code: 'LGAV',
  name: 'Athens Eleftherios Venizelos',
  coords: { lat: 37.9364, lon: 23.9445 },
  fboQuality: 'excellent',
};

export const LGMK: Airport = {
  code: 'LGMK',
  name: 'Mykonos',
  coords: { lat: 37.4351, lon: 25.3481 },
  fboQuality: 'adequate',
};

export const LDDU: Airport = {
  code: 'LDDU',
  name: 'Dubrovnik',
  coords: { lat: 42.5614, lon: 18.2682 },
  fboQuality: 'adequate',
};

export const LYTV: Airport = {
  code: 'LYTV',
  name: 'Tivat (Porto Montenegro)',
  coords: { lat: 42.4047, lon: 18.7233 },
  fboQuality: 'adequate',
};

export const LTFE: Airport = {
  code: 'LTFE',
  name: 'Bodrum Milas',
  coords: { lat: 37.2506, lon: 27.664 },
  fboQuality: 'adequate',
};

export const LTBA: Airport = {
  code: 'LTBA',
  name: 'Istanbul Atatürk (executive)',
  coords: { lat: 40.9769, lon: 28.8146 },
  fboQuality: 'excellent',
};

// ─────────────────────────────────────────────────────────────────────────────
// Benelux / Nordics / Central Europe
// ─────────────────────────────────────────────────────────────────────────────

export const EHBK: Airport = {
  code: 'EHBK',
  name: 'Maastricht Aachen',
  coords: { lat: 50.9117, lon: 5.7701 },
  fboQuality: 'adequate',
};

export const EHEH: Airport = {
  code: 'EHEH',
  name: 'Eindhoven',
  coords: { lat: 51.4501, lon: 5.3745 },
  fboQuality: 'adequate',
};

export const EHRD: Airport = {
  code: 'EHRD',
  name: 'Rotterdam The Hague',
  coords: { lat: 51.9569, lon: 4.4372 },
  fboQuality: 'excellent',
};

export const EBAW: Airport = {
  code: 'EBAW',
  name: 'Antwerp Deurne',
  coords: { lat: 51.1894, lon: 4.4603 },
  fboQuality: 'adequate',
};

export const EBBR: Airport = {
  code: 'EBBR',
  name: 'Brussels',
  coords: { lat: 50.9014, lon: 4.4844 },
  fboQuality: 'excellent',
};

export const EKCH: Airport = {
  code: 'EKCH',
  name: 'Copenhagen Kastrup',
  coords: { lat: 55.618, lon: 12.656 },
  fboQuality: 'excellent',
};

export const ESSB: Airport = {
  code: 'ESSB',
  name: 'Stockholm Bromma',
  coords: { lat: 59.3544, lon: 17.9417 },
  fboQuality: 'excellent',
};

export const ESNK: Airport = {
  code: 'ESNK',
  name: 'Kiruna (Abisko)',
  coords: { lat: 67.8221, lon: 20.3368 },
  fboQuality: 'adequate',
};

export const ENTC: Airport = {
  code: 'ENTC',
  name: 'Tromsø Langnes',
  coords: { lat: 69.6833, lon: 18.9189 },
  fboQuality: 'adequate',
};

export const ENBR: Airport = {
  code: 'ENBR',
  name: 'Bergen Flesland',
  coords: { lat: 60.2934, lon: 5.2181 },
  fboQuality: 'adequate',
};

export const BIRK: Airport = {
  code: 'BIRK',
  name: 'Reykjavík City',
  coords: { lat: 64.13, lon: -21.9406 },
  fboQuality: 'excellent',
};

export const EFRO: Airport = {
  code: 'EFRO',
  name: 'Rovaniemi',
  coords: { lat: 66.5648, lon: 25.8304 },
  fboQuality: 'adequate',
};

export const LKPR: Airport = {
  code: 'LKPR',
  name: 'Prague Václav Havel',
  coords: { lat: 50.1008, lon: 14.26 },
  fboQuality: 'excellent',
};

// ─────────────────────────────────────────────────────────────────────────────
// Middle East
// ─────────────────────────────────────────────────────────────────────────────

export const OMDW: Airport = {
  code: 'OMDW',
  name: 'Dubai Al Maktoum',
  coords: { lat: 24.8964, lon: 55.1614 },
  fboQuality: 'exceptional',
};

export const OMAD: Airport = {
  code: 'OMAD',
  name: 'Abu Dhabi Al Bateen Executive',
  coords: { lat: 24.4283, lon: 54.4581 },
  fboQuality: 'exceptional',
};

export const OTHH: Airport = {
  code: 'OTHH',
  name: 'Doha Hamad',
  coords: { lat: 25.2731, lon: 51.6081 },
  fboQuality: 'exceptional',
};

export const OEAO: Airport = {
  code: 'OEAO',
  name: 'AlUla',
  coords: { lat: 26.4767, lon: 38.0231 },
  fboQuality: 'adequate',
};

export const OEJN: Airport = {
  code: 'OEJN',
  name: 'Jeddah King Abdulaziz',
  coords: { lat: 21.6796, lon: 39.1565 },
  fboQuality: 'excellent',
};

export const OOMS: Airport = {
  code: 'OOMS',
  name: 'Muscat',
  coords: { lat: 23.5933, lon: 58.2844 },
  fboQuality: 'excellent',
};

// ─────────────────────────────────────────────────────────────────────────────
// Asia
// ─────────────────────────────────────────────────────────────────────────────

export const RJTT: Airport = {
  code: 'RJTT',
  name: 'Tokyo Haneda',
  coords: { lat: 35.5533, lon: 139.7811 },
  fboQuality: 'excellent',
};

export const RJOO: Airport = {
  code: 'RJOO',
  name: 'Osaka Itami (Kyoto)',
  coords: { lat: 34.7855, lon: 135.4382 },
  fboQuality: 'excellent',
};

export const RJCC: Airport = {
  code: 'RJCC',
  name: 'New Chitose (Niseko)',
  coords: { lat: 42.7752, lon: 141.6923 },
  fboQuality: 'excellent',
};

export const RJFF: Airport = {
  code: 'RJFF',
  name: 'Fukuoka',
  coords: { lat: 33.5859, lon: 130.4508 },
  fboQuality: 'adequate',
};

export const RKSS: Airport = {
  code: 'RKSS',
  name: 'Seoul Gimpo',
  coords: { lat: 37.5583, lon: 126.7906 },
  fboQuality: 'excellent',
};

export const VHHH: Airport = {
  code: 'VHHH',
  name: 'Hong Kong International',
  coords: { lat: 22.308, lon: 113.9185 },
  fboQuality: 'exceptional',
};

export const WSSL: Airport = {
  code: 'WSSL',
  name: 'Singapore Seletar',
  coords: { lat: 1.4169, lon: 103.8681 },
  fboQuality: 'exceptional',
};

export const VTBD: Airport = {
  code: 'VTBD',
  name: 'Bangkok Don Mueang',
  coords: { lat: 13.9126, lon: 100.6068 },
  fboQuality: 'excellent',
};

export const VTSP: Airport = {
  code: 'VTSP',
  name: 'Phuket',
  coords: { lat: 8.1132, lon: 98.3169 },
  fboQuality: 'excellent',
};

export const VIDP: Airport = {
  code: 'VIDP',
  name: 'Delhi Indira Gandhi',
  coords: { lat: 28.5562, lon: 77.1 },
  fboQuality: 'excellent',
};

export const VIJP: Airport = {
  code: 'VIJP',
  name: 'Jaipur',
  coords: { lat: 26.8242, lon: 75.8122 },
  fboQuality: 'adequate',
};

export const VOCI: Airport = {
  code: 'VOCI',
  name: 'Kochi (Kerala)',
  coords: { lat: 10.152, lon: 76.4019 },
  fboQuality: 'adequate',
};

export const VABB: Airport = {
  code: 'VABB',
  name: 'Mumbai Chhatrapati Shivaji',
  coords: { lat: 19.0887, lon: 72.8679 },
  fboQuality: 'excellent',
};

export const VQPR: Airport = {
  code: 'VQPR',
  name: 'Paro',
  coords: { lat: 27.4032, lon: 89.4246 },
  fboQuality: 'adequate',
};

export const VRMM: Airport = {
  code: 'VRMM',
  name: 'Malé Velana',
  coords: { lat: 4.1918, lon: 73.5291 },
  fboQuality: 'excellent',
};

export const VCBI: Airport = {
  code: 'VCBI',
  name: 'Colombo Bandaranaike',
  coords: { lat: 7.1808, lon: 79.8841 },
  fboQuality: 'adequate',
};

export const WADD: Airport = {
  code: 'WADD',
  name: 'Bali Ngurah Rai',
  coords: { lat: -8.7482, lon: 115.1675 },
  fboQuality: 'excellent',
};

export const ZSPD: Airport = {
  code: 'ZSPD',
  name: 'Shanghai Pudong',
  coords: { lat: 31.1443, lon: 121.8083 },
  fboQuality: 'excellent',
};

export const VDSR: Airport = {
  code: 'VDSR',
  name: 'Siem Reap Angkor',
  coords: { lat: 13.4097, lon: 103.813 },
  fboQuality: 'adequate',
};

export const VLLB: Airport = {
  code: 'VLLB',
  name: 'Luang Prabang',
  coords: { lat: 19.8973, lon: 102.1608 },
  fboQuality: 'adequate',
};

export const ZUJZ: Airport = {
  code: 'ZUJZ',
  name: 'Jiuzhaigou Huanglong',
  coords: { lat: 32.8533, lon: 103.6821 },
  fboQuality: 'adequate',
};

// ─────────────────────────────────────────────────────────────────────────────
// North America
// ─────────────────────────────────────────────────────────────────────────────

export const KTEB: Airport = {
  code: 'KTEB',
  name: 'Teterboro',
  coords: { lat: 40.8501, lon: -74.0608 },
  fboQuality: 'exceptional',
};

export const KHPN: Airport = {
  code: 'KHPN',
  name: 'Westchester County',
  coords: { lat: 41.067, lon: -73.7076 },
  fboQuality: 'excellent',
};

export const KVNY: Airport = {
  code: 'KVNY',
  name: 'Van Nuys',
  coords: { lat: 34.2098, lon: -118.4899 },
  fboQuality: 'exceptional',
};

export const KBUR: Airport = {
  code: 'KBUR',
  name: 'Hollywood Burbank',
  coords: { lat: 34.2007, lon: -118.3585 },
  fboQuality: 'excellent',
};

export const KHND: Airport = {
  code: 'KHND',
  name: 'Henderson Executive (Las Vegas)',
  coords: { lat: 35.9728, lon: -115.1344 },
  fboQuality: 'excellent',
};

export const KOPF: Airport = {
  code: 'KOPF',
  name: 'Miami–Opa Locka Executive',
  coords: { lat: 25.907, lon: -80.2784 },
  fboQuality: 'exceptional',
};

export const KFXE: Airport = {
  code: 'KFXE',
  name: 'Fort Lauderdale Executive',
  coords: { lat: 26.1973, lon: -80.1707 },
  fboQuality: 'excellent',
};

export const KPBI: Airport = {
  code: 'KPBI',
  name: 'Palm Beach International',
  coords: { lat: 26.6832, lon: -80.0956 },
  fboQuality: 'excellent',
};

export const KASE: Airport = {
  code: 'KASE',
  name: 'Aspen/Pitkin County',
  coords: { lat: 39.2232, lon: -106.8687 },
  fboQuality: 'excellent',
};

export const KEGE: Airport = {
  code: 'KEGE',
  name: 'Eagle County (Vail)',
  coords: { lat: 39.6426, lon: -106.9177 },
  fboQuality: 'excellent',
};

export const KJAC: Airport = {
  code: 'KJAC',
  name: 'Jackson Hole',
  coords: { lat: 43.6073, lon: -110.7377 },
  fboQuality: 'excellent',
};

export const KSUN: Airport = {
  code: 'KSUN',
  name: 'Friedman Memorial (Sun Valley)',
  coords: { lat: 43.5044, lon: -114.2961 },
  fboQuality: 'adequate',
};

export const KBJC: Airport = {
  code: 'KBJC',
  name: 'Rocky Mountain Metropolitan (Boulder)',
  coords: { lat: 39.9088, lon: -105.1172 },
  fboQuality: 'excellent',
};

export const KSLC: Airport = {
  code: 'KSLC',
  name: 'Salt Lake City',
  coords: { lat: 40.7884, lon: -111.9778 },
  fboQuality: 'excellent',
};

export const KMRY: Airport = {
  code: 'KMRY',
  name: 'Monterey Regional',
  coords: { lat: 36.587, lon: -121.8429 },
  fboQuality: 'excellent',
};

export const KTRM: Airport = {
  code: 'KTRM',
  name: 'Jacqueline Cochran Regional (Thermal)',
  coords: { lat: 33.6267, lon: -116.1601 },
  fboQuality: 'excellent',
};

export const KPSP: Airport = {
  code: 'KPSP',
  name: 'Palm Springs International',
  coords: { lat: 33.8297, lon: -116.5067 },
  fboQuality: 'excellent',
};

export const KRNO: Airport = {
  code: 'KRNO',
  name: 'Reno–Tahoe International',
  coords: { lat: 39.4991, lon: -119.7681 },
  fboQuality: 'excellent',
};

export const KAGS: Airport = {
  code: 'KAGS',
  name: 'Augusta Regional',
  coords: { lat: 33.3699, lon: -81.9645 },
  fboQuality: 'adequate',
};

export const KSDF: Airport = {
  code: 'KSDF',
  name: 'Louisville Muhammad Ali',
  coords: { lat: 38.1744, lon: -85.7365 },
  fboQuality: 'excellent',
};

export const KACK: Airport = {
  code: 'KACK',
  name: 'Nantucket Memorial',
  coords: { lat: 41.2531, lon: -70.0602 },
  fboQuality: 'adequate',
};

export const KSAF: Airport = {
  code: 'KSAF',
  name: 'Santa Fe Regional',
  coords: { lat: 35.6171, lon: -106.0894 },
  fboQuality: 'adequate',
};

export const KPWK: Airport = {
  code: 'KPWK',
  name: 'Chicago Executive',
  coords: { lat: 42.1142, lon: -87.9015 },
  fboQuality: 'excellent',
};

export const KCHS: Airport = {
  code: 'KCHS',
  name: 'Charleston International',
  coords: { lat: 32.8986, lon: -80.0405 },
  fboQuality: 'adequate',
};

export const KHOU: Airport = {
  code: 'KHOU',
  name: 'Houston Hobby',
  coords: { lat: 29.6454, lon: -95.2789 },
  fboQuality: 'excellent',
};

export const CYTZ: Airport = {
  code: 'CYTZ',
  name: 'Billy Bishop Toronto City',
  coords: { lat: 43.6275, lon: -79.3962 },
  fboQuality: 'excellent',
};

export const CYVR: Airport = {
  code: 'CYVR',
  name: 'Vancouver International',
  coords: { lat: 49.1939, lon: -123.1844 },
  fboQuality: 'excellent',
};

export const MMSD: Airport = {
  code: 'MMSD',
  name: 'Los Cabos',
  coords: { lat: 23.1518, lon: -109.7211 },
  fboQuality: 'excellent',
};

export const MMOX: Airport = {
  code: 'MMOX',
  name: 'Oaxaca Xoxocotlán',
  coords: { lat: 16.999, lon: -96.7266 },
  fboQuality: 'adequate',
};

export const MMUN: Airport = {
  code: 'MMUN',
  name: 'Cancún',
  coords: { lat: 21.0365, lon: -86.8771 },
  fboQuality: 'excellent',
};

// ─────────────────────────────────────────────────────────────────────────────
// Caribbean
// ─────────────────────────────────────────────────────────────────────────────

export const TFFJ: Airport = {
  code: 'TFFJ',
  name: 'Gustaf III, St Barthélemy',
  coords: { lat: 17.9044, lon: -62.8436 },
  fboQuality: 'adequate',
};

export const TNCM: Airport = {
  code: 'TNCM',
  name: 'Princess Juliana, Sint Maarten',
  coords: { lat: 18.041, lon: -63.1089 },
  fboQuality: 'excellent',
};

export const TAPA: Airport = {
  code: 'TAPA',
  name: 'V. C. Bird, Antigua',
  coords: { lat: 17.1367, lon: -61.7927 },
  fboQuality: 'excellent',
};

export const TBPB: Airport = {
  code: 'TBPB',
  name: 'Grantley Adams, Barbados',
  coords: { lat: 13.0746, lon: -59.4925 },
  fboQuality: 'excellent',
};

export const MYEF: Airport = {
  code: 'MYEF',
  name: 'Exuma International',
  coords: { lat: 23.5626, lon: -75.8779 },
  fboQuality: 'adequate',
};

export const MYNN: Airport = {
  code: 'MYNN',
  name: 'Lynden Pindling, Nassau',
  coords: { lat: 25.039, lon: -77.4661 },
  fboQuality: 'excellent',
};

export const TTPP: Airport = {
  code: 'TTPP',
  name: 'Piarco, Trinidad',
  coords: { lat: 10.5954, lon: -61.3372 },
  fboQuality: 'adequate',
};

export const MDPC: Airport = {
  code: 'MDPC',
  name: 'Punta Cana',
  coords: { lat: 18.5674, lon: -68.3634 },
  fboQuality: 'excellent',
};

// ─────────────────────────────────────────────────────────────────────────────
// South America / Antarctica
// ─────────────────────────────────────────────────────────────────────────────

export const SBJR: Airport = {
  code: 'SBJR',
  name: 'Rio de Janeiro Jacarepaguá',
  coords: { lat: -22.9875, lon: -43.37 },
  fboQuality: 'excellent',
};

export const SBSP: Airport = {
  code: 'SBSP',
  name: 'São Paulo Congonhas',
  coords: { lat: -23.6261, lon: -46.6564 },
  fboQuality: 'excellent',
};

export const SADP: Airport = {
  code: 'SADP',
  name: 'San Fernando (Buenos Aires)',
  coords: { lat: -34.4527, lon: -58.5896 },
  fboQuality: 'excellent',
};

export const SCEL: Airport = {
  code: 'SCEL',
  name: 'Santiago Arturo Merino Benítez',
  coords: { lat: -33.393, lon: -70.7858 },
  fboQuality: 'excellent',
};

export const SPJC: Airport = {
  code: 'SPJC',
  name: 'Lima Jorge Chávez',
  coords: { lat: -12.0219, lon: -77.1143 },
  fboQuality: 'excellent',
};

export const SPZO: Airport = {
  code: 'SPZO',
  name: 'Cusco Alejandro Velasco Astete',
  coords: { lat: -13.5357, lon: -71.9388 },
  fboQuality: 'adequate',
};

export const SEGS: Airport = {
  code: 'SEGS',
  name: 'Seymour, Baltra (Galápagos)',
  coords: { lat: -0.4536, lon: -90.2659 },
  fboQuality: 'adequate',
};

export const SAWH: Airport = {
  code: 'SAWH',
  name: 'Ushuaia Malvinas Argentinas',
  coords: { lat: -54.8433, lon: -68.2958 },
  fboQuality: 'adequate',
};

export const SCCI: Airport = {
  code: 'SCCI',
  name: 'Punta Arenas Presidente Ibáñez',
  coords: { lat: -53.0026, lon: -70.8546 },
  fboQuality: 'adequate',
};

export const SCGC: Airport = {
  code: 'SCGC',
  name: 'Union Glacier Blue-Ice Runway',
  coords: { lat: -79.7772, lon: -83.3208 },
  fboQuality: 'adequate',
};

// ─────────────────────────────────────────────────────────────────────────────
// Africa / Indian Ocean
// ─────────────────────────────────────────────────────────────────────────────

export const HKNW: Airport = {
  code: 'HKNW',
  name: 'Nairobi Wilson',
  coords: { lat: -1.3217, lon: 36.8148 },
  fboQuality: 'adequate',
};

export const HKJK: Airport = {
  code: 'HKJK',
  name: 'Nairobi Jomo Kenyatta',
  coords: { lat: -1.3192, lon: 36.9278 },
  fboQuality: 'excellent',
};

export const HTKJ: Airport = {
  code: 'HTKJ',
  name: 'Kilimanjaro',
  coords: { lat: -3.4294, lon: 37.0745 },
  fboQuality: 'adequate',
};

export const HTZA: Airport = {
  code: 'HTZA',
  name: 'Zanzibar Abeid Amani Karume',
  coords: { lat: -6.222, lon: 39.2249 },
  fboQuality: 'adequate',
};

export const HRYR: Airport = {
  code: 'HRYR',
  name: 'Kigali',
  coords: { lat: -1.9686, lon: 30.1395 },
  fboQuality: 'excellent',
};

export const HUEN: Airport = {
  code: 'HUEN',
  name: 'Entebbe',
  coords: { lat: 0.0424, lon: 32.4435 },
  fboQuality: 'adequate',
};

export const FALA: Airport = {
  code: 'FALA',
  name: 'Lanseria (Johannesburg)',
  coords: { lat: -25.9385, lon: 27.9261 },
  fboQuality: 'exceptional',
};

export const FACT: Airport = {
  code: 'FACT',
  name: 'Cape Town International',
  coords: { lat: -33.9715, lon: 18.6021 },
  fboQuality: 'excellent',
};

export const FBMN: Airport = {
  code: 'FBMN',
  name: 'Maun (Okavango)',
  coords: { lat: -19.9726, lon: 23.4311 },
  fboQuality: 'adequate',
};

export const FYWE: Airport = {
  code: 'FYWE',
  name: 'Eros, Windhoek',
  coords: { lat: -22.6122, lon: 17.0804 },
  fboQuality: 'adequate',
};

export const FVFA: Airport = {
  code: 'FVFA',
  name: 'Victoria Falls',
  coords: { lat: -18.0959, lon: 25.839 },
  fboQuality: 'adequate',
};

export const GMMX: Airport = {
  code: 'GMMX',
  name: 'Marrakech Menara',
  coords: { lat: 31.6069, lon: -8.0363 },
  fboQuality: 'excellent',
};

export const HELX: Airport = {
  code: 'HELX',
  name: 'Luxor',
  coords: { lat: 25.671, lon: 32.7066 },
  fboQuality: 'adequate',
};

export const FSIA: Airport = {
  code: 'FSIA',
  name: 'Seychelles, Mahé',
  coords: { lat: -4.6743, lon: 55.5218 },
  fboQuality: 'excellent',
};

export const FIMP: Airport = {
  code: 'FIMP',
  name: 'Mauritius Sir Seewoosagur Ramgoolam',
  coords: { lat: -20.4302, lon: 57.6836 },
  fboQuality: 'excellent',
};

// ─────────────────────────────────────────────────────────────────────────────
// Oceania
// ─────────────────────────────────────────────────────────────────────────────

export const YSSY: Airport = {
  code: 'YSSY',
  name: 'Sydney Kingsford Smith',
  coords: { lat: -33.9399, lon: 151.1753 },
  fboQuality: 'excellent',
};

export const YMEN: Airport = {
  code: 'YMEN',
  name: 'Melbourne Essendon Fields',
  coords: { lat: -37.7281, lon: 144.9019 },
  fboQuality: 'excellent',
};

export const YMHB: Airport = {
  code: 'YMHB',
  name: 'Hobart',
  coords: { lat: -42.8361, lon: 147.5103 },
  fboQuality: 'adequate',
};

export const YBCS: Airport = {
  code: 'YBCS',
  name: 'Cairns',
  coords: { lat: -16.8858, lon: 145.7553 },
  fboQuality: 'adequate',
};

export const YPPH: Airport = {
  code: 'YPPH',
  name: 'Perth',
  coords: { lat: -31.9403, lon: 115.9669 },
  fboQuality: 'excellent',
};

export const NZQN: Airport = {
  code: 'NZQN',
  name: 'Queenstown',
  coords: { lat: -45.0211, lon: 168.7392 },
  fboQuality: 'excellent',
};

export const NTAA: Airport = {
  code: 'NTAA',
  name: 'Tahiti Faa’a',
  coords: { lat: -17.5537, lon: -149.607 },
  fboQuality: 'adequate',
};

export const NFFN: Airport = {
  code: 'NFFN',
  name: 'Nadi, Fiji',
  coords: { lat: -17.7554, lon: 177.4434 },
  fboQuality: 'adequate',
};

// ─────────────────────────────────────────────────────────────────────────────
// Regional fields added for specific destinations that no hub serves sensibly
// ─────────────────────────────────────────────────────────────────────────────

export const MMTO: Airport = {
  code: 'MMTO',
  name: 'Toluca (Mexico City executive)',
  coords: { lat: 19.3371, lon: -99.566 },
  fboQuality: 'excellent',
};

export const MRLB: Airport = {
  code: 'MRLB',
  name: 'Guanacaste Daniel Oduber',
  coords: { lat: 10.5933, lon: -85.5444 },
  fboQuality: 'excellent',
};

export const SBCY: Airport = {
  code: 'SBCY',
  name: 'Cuiabá Marechal Rondon (Pantanal)',
  coords: { lat: -15.6529, lon: -56.1167 },
  fboQuality: 'adequate',
};

export const SAME: Airport = {
  code: 'SAME',
  name: 'Mendoza El Plumerillo',
  coords: { lat: -32.8317, lon: -68.7929 },
  fboQuality: 'adequate',
};

export const FLMF: Airport = {
  code: 'FLMF',
  name: 'Mfuwe (South Luangwa)',
  coords: { lat: -13.2589, lon: 31.9365 },
  fboQuality: 'adequate',
};

export const FALE: Airport = {
  code: 'FALE',
  name: 'King Shaka, Durban',
  coords: { lat: -29.6144, lon: 31.1197 },
  fboQuality: 'excellent',
};

export const HAGN: Airport = {
  code: 'HAGN',
  name: 'Gondar Atse Tewodros',
  coords: { lat: 12.5199, lon: 37.434 },
  fboQuality: 'adequate',
};

export const OERK: Airport = {
  code: 'OERK',
  name: 'Riyadh King Khalid',
  coords: { lat: 24.9576, lon: 46.6988 },
  fboQuality: 'excellent',
};

export const ZMCK: Airport = {
  code: 'ZMCK',
  name: 'Chinggis Khaan, Ulaanbaatar',
  coords: { lat: 47.6531, lon: 106.8197 },
  fboQuality: 'adequate',
};

/** Every gateway in the registry, for validation and UI lookups. */
export const AIRPORTS: Airport[] = [
  LFMD, LFMN, LFTZ, LFPB, LFRM, LFLL, LFBD, LFMV, LFKB, LFLB, LFLJ,
  LSGG, LSZH, LSGS, LSZS, LSGK, LSZA, LFSB, LSZB, LOWI, LOWS, LOWW,
  EDMO, EDDM, EDDN, EDDB,
  EGLF, EGGW, EGKB, EGHR, EGHI, EGPH, EGPN, EGPF, EINN, EIDW,
  LIML, LIRA, LIPZ, LIRN, LIRQ, LIQS, LIEO, LIMF, LICJ, LIRI,
  LEZL, LEMG, LEIB, LEPA, LEVC, LECU, LPCS, LPFR, LMML,
  LGAV, LGMK, LDDU, LYTV, LTFE, LTBA,
  EHBK, EHEH, EHRD, EBAW, EBBR, EKCH, ESSB, ESNK, ENTC, ENBR, BIRK, EFRO, LKPR,
  OMDW, OMAD, OTHH, OEAO, OEJN, OOMS,
  RJTT, RJOO, RJCC, RJFF, RKSS, VHHH, WSSL, VTBD, VTSP,
  VIDP, VIJP, VOCI, VABB, VQPR, VRMM, VCBI, WADD, ZSPD, VDSR, VLLB, ZUJZ,
  KTEB, KHPN, KVNY, KBUR, KHND, KOPF, KFXE, KPBI, KASE, KEGE, KJAC, KSUN,
  KBJC, KSLC, KMRY, KTRM, KPSP, KRNO, KAGS, KSDF, KACK, KSAF, KPWK, KCHS,
  KHOU, CYTZ, CYVR, MMSD, MMOX, MMUN,
  TFFJ, TNCM, TAPA, TBPB, MYEF, MDPC, MYNN, TTPP,
  SBJR, SBSP, SADP, SCEL, SPJC, SPZO, SEGS, SAWH, SCCI, SCGC,
  HKNW, HKJK, HTKJ, HTZA, HRYR, HUEN, FALA, FACT, FBMN, FYWE, FVFA, GMMX,
  HELX, FSIA, FIMP,
  YSSY, YMEN, YMHB, YBCS, YPPH, NZQN, NTAA, NFFN,
  MMTO, MRLB, SBCY, SAME, FLMF, FALE, HAGN, OERK, ZMCK,
];
