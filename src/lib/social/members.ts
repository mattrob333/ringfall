/**
 * MERIDIAN — the membership.
 *
 * Eighty fictional members. There is no backend and there are no real
 * users, so this roster *is* the club: every peer avatar, every group host,
 * every "four members you'd fly with are watching this" resolves to a row here.
 *
 * Rules the roster follows, because a thin one is instantly detectable:
 *
 *   • Real cities, real coordinates, real home jet ports. A member based in
 *     Gstaad keeps the aircraft at Saanen, not "Gstaad International".
 *   • The demographics of the actual market — European, North and South
 *     American, Gulf, East and South Asian, African, Antipodean. Not a
 *     roomful of Anglo surnames with one token exception.
 *   • Bios ≤ 140 characters, dry, specific, and slightly unflattering. These
 *     people do not describe themselves as passionate explorers.
 *   • Roughly 40% own an aircraft, and it is a real airframe with a real
 *     cabin size, because `charter.ts` reasons about seats.
 *
 * Every name is invented. Any resemblance to a living person is accidental and
 * unintended — none of these are keyed to real individuals.
 */

import { AIRPORTS } from '@/lib/data/events/airports';
import { greatCircleDistanceNm } from '@/lib/geo/projection';
import type { Airport, EventCategory, GeoPoint, Member, MemberTier } from '@/lib/types';
import { hashSeed, mulberry32 } from './rng';

/**
 * Compact row form. Expanding eighty full `Member` literals would be 900 lines of
 * mostly punctuation; this keeps the roster readable as a roster.
 */
type Row = readonly [
  name: string,
  handle: string,
  city: string,
  country: string,
  lat: number,
  lon: number,
  /** ICAO of the field the aircraft actually sits on */
  port: string,
  tier: MemberTier,
  since: string,
  bio: string,
  interests: readonly EventCategory[],
  openToJetShare: boolean,
  aircraft?: string,
];

const ROWS: readonly Row[] = [
  // ── Europe ────────────────────────────────────────────────────────────────
  [
    'Aurélie Vasseur-Roche', 'avroche', 'Paris', 'France', 48.8566, 2.3522, 'LFPB',
    'founding', '2016-03-11',
    'Family foundation that buys nothing made after 1972. Two museum boards, both of which she complains about at length.',
    ['art', 'design', 'fashion', 'gala'], true, 'Falcon 8X',
  ],
  [
    'Teodor Marchetti', 'tmarchetti', 'Milan', 'Italy', 45.4642, 9.19, 'LIML',
    'founding', '2016-09-02',
    'Fourth generation in textiles. Owns eleven cars that do not start and one that frightens him.',
    ['motorsport', 'fashion', 'design'], true, 'Challenger 350',
  ],
  [
    'Camilla Ashgrove', 'cashgrove', 'London', 'United Kingdom', 51.5074, -0.1278, 'EGLF',
    'founding', '2017-01-19',
    'Breeds event horses in Gloucestershire. Reads the going report before the weather.',
    ['equestrian', 'tennis', 'gala', 'nature'], false, 'Falcon 2000LXS',
  ],
  [
    'Kasper Lindqvist', 'klindqvist', 'Stockholm', 'Sweden', 59.3293, 18.0686, 'ESSB',
    'signature', '2019-05-27',
    'Sold a shipyard, kept the drawing office. Prefers boats that are difficult to sail.',
    ['sailing', 'design', 'nature'], true,
  ],
  [
    'Delphine Aubusson', 'daubusson', 'Nice', 'France', 43.7102, 7.262, 'LFMN',
    'signature', '2018-06-14',
    'Runs a gallery in the old town that opens when she is in the mood. Sails better than she hangs pictures.',
    ['sailing', 'art', 'fashion'], true,
  ],
  [
    'Anton Reiswitz', 'areiswitz', 'Munich', 'Germany', 48.1351, 11.582, 'EDMO',
    'signature', '2018-11-08',
    'Third-party supplier to half the grid. Will explain brake ducts to anyone who slows down.',
    ['motorsport', 'ski', 'music'], true, 'Citation Longitude',
  ],
  [
    'Ingrid Van Doorne', 'ivandoorne', 'Amsterdam', 'Netherlands', 52.3676, 4.9041, 'EHRD',
    'signature', '2020-02-21',
    'Buys buildings other people have given up on. Owns four Rietveld chairs and sits in none of them.',
    ['design', 'art', 'sailing'], true,
  ],
  [
    'Lorenzo Baccarini', 'lbaccarini', 'Rome', 'Italy', 41.9028, 12.4964, 'LIRA',
    'charter', '2021-04-30',
    'Restaurant group across three cities. Eats at none of them and says so publicly.',
    ['culinary', 'art', 'gala'], true,
  ],
  [
    'Duarte Almeida-Serra', 'dalmeidaserra', 'Lisbon', 'Portugal', 38.7223, -9.1393, 'LPCS',
    'signature', '2019-10-05',
    'Cork, then solar, now mostly the boat. Crossed the Atlantic twice and would rather not discuss the second.',
    ['sailing', 'culinary', 'music'], true, 'Praetor 600',
  ],
  [
    'Fernando Etxeberria', 'fetxeberria', 'Madrid', 'Spain', 40.4168, -3.7038, 'LECU',
    'signature', '2020-07-16',
    'Bought a links course to stop it being turned into flats. Plays it badly, twice a week.',
    ['golf', 'culinary', 'motorsport'], false,
  ],
  [
    'Solène Berthier-Kwon', 'sberthierkwon', 'Geneva', 'Switzerland', 46.2044, 6.1432, 'LSGG',
    'founding', '2016-11-30',
    'Private bank, private opinions. Skis in March because February is for people with jobs.',
    ['ski', 'art', 'wellness'], false, 'Global 7500',
  ],
  [
    'Renata Kozłowska-Ferri', 'rkozlowska', 'Zurich', 'Switzerland', 47.3769, 8.5417, 'LSZH',
    'signature', '2019-01-24',
    'Reinsurance. Collects Bauhaus ceramics and rates every hotel she stays in out of four.',
    ['design', 'art', 'wellness'], true,
  ],
  [
    'Ilse Marquardt', 'imarquardt', 'Gstaad', 'Switzerland', 46.4728, 7.2867, 'LSGK',
    'founding', '2017-12-02',
    'Grew up between a stud farm and a ski lift. Still cannot decide which ruined her more.',
    ['ski', 'equestrian', 'gala'], false, 'Citation CJ3+',
  ],
  [
    'Élodie Trémaux', 'etremaux', 'Courchevel', 'France', 45.4154, 6.634, 'LFLB',
    'signature', '2020-12-11',
    'Third season running the guides she used to hire. Has opinions about everyone else’s boots.',
    ['ski', 'wellness', 'fashion'], true,
  ],
  [
    'Constantin Drăgoi', 'cdragoi', 'Vienna', 'Austria', 48.2082, 16.3738, 'LOWW',
    'signature', '2018-09-29',
    'Underwrites two opera houses. Falls asleep in one of them reliably and denies it.',
    ['music', 'cultural', 'gala'], false,
  ],
  [
    'Halvard Bruun', 'hbruun', 'Copenhagen', 'Denmark', 55.6761, 12.5683, 'EKRK',
    'signature', '2019-06-18',
    'Furniture, then hotels, now a small foundry. Believes most things are over-designed, including his own.',
    ['design', 'sailing', 'culinary'], true,
  ],
  [
    'Beatrix Halvorsen', 'bhalvorsen', 'Oslo', 'Norway', 59.9139, 10.7522, 'ENGM',
    'signature', '2018-03-06',
    'Offshore wind. Walks the Hardangervidda every August alone, which the family considers a phase.',
    ['ski', 'nature', 'wellness'], true, 'Praetor 600',
  ],
  [
    'Konstantin Halberg', 'khalberg', 'Helsinki', 'Finland', 60.1699, 24.9384, 'EFHK',
    'charter', '2022-05-09',
    'Icebreaker contracts and a glass house nobody can find. Fond of weather that keeps people away.',
    ['nature', 'design', 'ski'], true,
  ],
  [
    'Zofia Karnowska', 'zkarnowska', 'Warsaw', 'Poland', 52.2297, 21.0122, 'EPWA',
    'charter', '2021-02-14',
    'Logistics. Owns the largest private holding of interwar Polish posters and one very bad Malevich.',
    ['art', 'cultural', 'design'], true,
  ],
  [
    'Jean-Baptiste Okonjo', 'jbokonjo', 'Brussels', 'Belgium', 50.8503, 4.3517, 'EBAW',
    'signature', '2019-11-12',
    'Commodities lawyer by trade, Congolese modernism by obsession. Lends more than he hangs.',
    ['art', 'cultural', 'culinary'], true,
  ],
  [
    'Emeka Balogun-Reid', 'ebalogunreid', 'London', 'United Kingdom', 51.5074, -0.1278, 'EGGW',
    'signature', '2020-04-03',
    'Two labels and a stake in a stadium. Has never once sat in the seats he pays for.',
    ['music', 'film', 'tennis'], true, 'Gulfstream G280',
  ],
  [
    'Alexandra Feodorova-Byrne', 'afbyrne', 'Dublin', 'Ireland', 53.3498, -6.2603, 'EIWT',
    'charter', '2021-06-25',
    'Runs a stud in Kildare that has produced one great horse and forty expensive ones.',
    ['equestrian', 'nature', 'gala'], false,
  ],
  [
    'Nadia Rahimi-Voss', 'nrahimivoss', 'Berlin', 'Germany', 52.52, 13.405, 'EDDB',
    'signature', '2019-08-22',
    'Scores films, mostly ones nobody finishes. Keeps a Steinway in a former substation.',
    ['music', 'design', 'film'], true,
  ],
  [
    'Grigor Petrossian', 'gpetrossian', 'Monaco', 'Monaco', 43.7384, 7.4246, 'LFMN',
    'founding', '2016-05-08',
    'Shipping, third generation. Collects Twombly and bad habits in roughly equal measure.',
    ['motorsport', 'sailing', 'art'], false, 'Gulfstream G650ER',
  ],
  [
    'Matteo Salvarezza', 'msalvarezza', 'Ibiza', 'Spain', 38.9067, 1.4206, 'LEIB',
    'charter', '2022-03-17',
    'Two clubs, one vineyard, no phone after eleven. The vineyard is the one that worries him.',
    ['music', 'sailing', 'culinary'], true,
  ],
  [
    'Nour Bencherif', 'nbencherif', 'Cannes', 'France', 43.5528, 7.0174, 'LFMD',
    'signature', '2020-09-01',
    'Finances first features from a flat above the Croisette. Reads scripts on paper, always.',
    ['film', 'fashion', 'art'], true,
  ],
  [
    'Ndidi Achebe-Laurent', 'nachebelaurent', 'Paris', 'France', 48.8566, 2.3522, 'LFPB',
    'signature', '2019-03-28',
    'Buys couture archives before the houses realise what they have. Wears almost none of it.',
    ['fashion', 'film', 'art'], true,
  ],
  [
    'Yusuf Karahan', 'ykarahan', 'Istanbul', 'Türkiye', 41.0082, 28.9784, 'LTBA',
    'signature', '2018-12-19',
    'Fourth-generation carpet house turned auction consultancy. Distrusts anything catalogued.',
    ['cultural', 'culinary', 'art'], true,
  ],

  // ── Gulf & Levant ─────────────────────────────────────────────────────────
  [
    'Saeed bin Ghurair', 'sbinghurair', 'Dubai', 'United Arab Emirates', 25.2048, 55.2708, 'OMDW',
    'founding', '2016-10-22',
    'Ports and endurance horses. Considers the horses the serious business and says so at board meetings.',
    ['equestrian', 'motorsport', 'golf'], true, 'Gulfstream G650ER',
  ],
  [
    'Zainab Oduya', 'zoduya', 'Abu Dhabi', 'United Arab Emirates', 24.4539, 54.3773, 'OMAD',
    'signature', '2019-04-16',
    'Sovereign-fund alumna, now buys art for people who should not be trusted to buy it themselves.',
    ['art', 'equestrian', 'gala'], true,
  ],
  [
    'Yara Haddadin', 'yhaddadin', 'Doha', 'Qatar', 25.2854, 51.531, 'OTHH',
    'signature', '2020-01-09',
    'Built a museum wing and a fashion week in the same year. Only one of them worked.',
    ['fashion', 'gala', 'art'], true, 'Falcon 8X',
  ],
  [
    'Bassam Al-Muqrin', 'balmuqrin', 'Riyadh', 'Saudi Arabia', 24.7136, 46.6753, 'OERK',
    'signature', '2021-03-05',
    'Family industrials. Keeps a stable in Normandy and a workshop full of half-finished rally cars.',
    ['motorsport', 'equestrian', 'golf'], false, 'Global 7500',
  ],
  [
    'Mariam Al-Dossari', 'maldossari', 'Kuwait City', 'Kuwait', 29.3759, 47.9774, 'OKBK',
    'charter', '2022-02-26',
    'Third generation in shipping insurance. Dresses exclusively in things that no longer exist in production.',
    ['fashion', 'art', 'gala'], true,
  ],
  [
    'Rashid Al-Falasi', 'ralfalasi', 'Manama', 'Bahrain', 26.2285, 50.586, 'OBBI',
    'charter', '2023-03-08',
    'Bought a kart circuit at nineteen and has been explaining the decision ever since.',
    ['motorsport', 'golf', 'culinary'], true,
  ],
  [
    'Rania El-Kassab', 'relkassab', 'Beirut', 'Lebanon', 33.8938, 35.5018, 'OLBA',
    'signature', '2018-07-23',
    'Runs a press that publishes twelve titles a year. Half are poetry, all of them late.',
    ['art', 'culinary', 'cultural'], true,
  ],
  [
    'Dov Shternberg', 'dshternberg', 'Tel Aviv', 'Israel', 32.0853, 34.7818, 'LLBG',
    'charter', '2021-11-15',
    'Sold the second company, kept the first. Cooks for eighteen people every Friday without complaint.',
    ['culinary', 'music', 'nature'], true,
  ],
  [
    'Layla Sarraf-Whitcombe', 'lsarraf', 'Jeddah', 'Saudi Arabia', 21.4858, 39.1925, 'OEJN',
    'charter', '2023-05-19',
    'Diving concessions on the Red Sea. Prefers the reef to almost everyone who visits it.',
    ['nature', 'wellness', 'sailing'], true,
  ],

  // ── Africa ────────────────────────────────────────────────────────────────
  [
    'Marius Oyelaran', 'moyelaran', 'Lagos', 'Nigeria', 6.5244, 3.3792, 'DNMM',
    'signature', '2019-02-07',
    'Two record labels and a printing house. The printing house is the one he mentions first.',
    ['music', 'art', 'fashion'], true, 'Legacy 500',
  ],
  [
    'Chidiebere Nwokolo', 'cnwokolo', 'Accra', 'Ghana', 5.6037, -0.187, 'DGAA',
    'charter', '2022-04-12',
    'Telecoms towers, then a film fund. Backs one picture a year and has never seen a rough cut.',
    ['music', 'film', 'fashion'], true,
  ],
  [
    'Idris Wanjiru', 'iwanjiru', 'Nairobi', 'Kenya', -1.2921, 36.8219, 'HKNW',
    'signature', '2018-05-30',
    'Runs three conservancies. Refers to the lodges as an unfortunate necessity, which they are.',
    ['safari', 'nature', 'wellness'], true, 'Pilatus PC-24',
  ],
  [
    'Aisha Mwangi-Sorensen', 'amwangi', 'Cape Town', 'South Africa', -33.9249, 18.4241, 'FACT',
    'signature', '2020-06-08',
    'Vineyards in Stellenbosch and a marine reserve she funds and never visits.',
    ['safari', 'wellness', 'nature'], true,
  ],
  [
    'Thabo Mokoena-Sinclair', 'tmokoena', 'Johannesburg', 'South Africa', -26.2041, 28.0473, 'FALA',
    'charter', '2021-10-27',
    'Platinum, then private credit. Plays off six and lies about it in the other direction.',
    ['golf', 'safari', 'music'], true,
  ],
  [
    'Omar Tazi-Belkacem', 'otazi', 'Marrakech', 'Morocco', 31.6295, -7.9811, 'GMMX',
    'signature', '2019-09-04',
    'Restored four riads and sold three. Keeps the one with the worst plumbing.',
    ['cultural', 'design', 'music'], true,
  ],
  [
    'Amara Sesay-Grant', 'asesaygrant', 'Kigali', 'Rwanda', -1.9441, 30.0619, 'HRYR',
    'charter', '2023-02-11',
    'Coffee estates and a design residency. Will talk about altitude for longer than is polite.',
    ['nature', 'design', 'safari'], true,
  ],
  [
    'Farida Boulahya', 'fboulahya', 'Casablanca', 'Morocco', 33.5731, -7.5898, 'GMMN',
    'charter', '2022-11-06',
    'Phosphates by inheritance, contemporary ceramics by choice. Rarely explains the connection.',
    ['art', 'design', 'cultural'], true,
  ],

  // ── Asia ──────────────────────────────────────────────────────────────────
  [
    'Hana Fujisawa-Beltrán', 'hfujisawa', 'Tokyo', 'Japan', 35.6762, 139.6503, 'RJTT',
    'founding', '2017-04-25',
    'Two Michelin kitchens, neither of which she is allowed to cook in. Owns the buildings instead.',
    ['culinary', 'wellness', 'art'], true, 'Global 7500',
  ],
  [
    'Sung-min Baek', 'smbaek', 'Seoul', 'South Korea', 37.5665, 126.978, 'RKSS',
    'signature', '2020-03-19',
    'Produces four features a year and finishes maybe two. Owns a projector older than the studio.',
    ['film', 'design', 'culinary'], true,
  ],
  [
    'Wen-Hsu Liao', 'whliao', 'Taipei', 'Taiwan', 25.033, 121.5654, 'RCSS',
    'signature', '2019-12-01',
    'Semiconductors on the family side, a tea house on hers. Guess which one she is at.',
    ['design', 'wellness', 'art'], true,
  ],
  [
    'Hiro Tanabe-Corliss', 'htanabe', 'Hong Kong', 'Hong Kong SAR', 22.3193, 114.1694, 'VHHH',
    'founding', '2016-08-14',
    'Auction house then his own advisory. Buys ink paintings and sells everything with a signature.',
    ['art', 'culinary', 'design'], true, 'Falcon 8X',
  ],
  [
    'Mei-Ling Ostrowska', 'mlostrowska', 'Shanghai', 'China', 31.2304, 121.4737, 'ZSSS',
    'signature', '2020-10-14',
    'Built a department store nobody thought would work. Still refuses to stock anything seasonal.',
    ['fashion', 'art', 'design'], true,
  ],
  [
    'Sirinya Vorapatr', 'svorapatr', 'Bangkok', 'Thailand', 13.7563, 100.5018, 'VTBD',
    'signature', '2019-07-09',
    'Hospitality, six properties. Has stayed one night in each and complained in writing about all six.',
    ['wellness', 'culinary', 'cultural'], true, 'Citation Latitude',
  ],
  [
    'Sanjay Mistry-Aldridge', 'smistry', 'Singapore', 'Singapore', 1.3521, 103.8198, 'WSSL',
    'signature', '2018-10-16',
    'Ran a family office, now runs a golf calendar. The calendar is materially more demanding.',
    ['golf', 'tennis', 'culinary'], true, 'Challenger 350',
  ],
  [
    'Nikhil Ravindra Sarnaik', 'nrsarnaik', 'Mumbai', 'India', 19.076, 72.8777, 'VABB',
    'founding', '2017-02-28',
    'Second-generation infrastructure. Watches practice sessions and skips the races themselves.',
    ['motorsport', 'tennis', 'golf'], true, 'Gulfstream G650ER',
  ],
  [
    'Vikram Chandrasekaran', 'vchandra', 'Delhi', 'India', 28.6139, 77.209, 'VIDP',
    'signature', '2019-05-13',
    'Textiles, then a private museum in Jaipur. Argues with his own curators in public.',
    ['cultural', 'art', 'equestrian'], true,
  ],
  [
    'Priya Anandavelu', 'panandavelu', 'Bengaluru', 'India', 12.9716, 77.5946, 'VOBL',
    'charter', '2021-07-21',
    'Two exits, one ashram she funds and privately finds ridiculous. Goes anyway, every March.',
    ['wellness', 'nature', 'film'], true,
  ],
  [
    'Rahul Bhattacharya-Neve', 'rbneve', 'Colombo', 'Sri Lanka', 6.9271, 79.8612, 'VCBI',
    'charter', '2022-06-30',
    'Tea, then a dive operation off Trincomalee. The tea subsidises the diving and always has.',
    ['nature', 'wellness', 'sailing'], true,
  ],
  [
    'Jian-Wei Ruan', 'jwruan', 'Beijing', 'China', 39.9042, 116.4074, 'ZBAA',
    'signature', '2020-05-26',
    'Private equity by day, Song ceramics by night. Considers both to be about patience.',
    ['art', 'cultural', 'golf'], false, 'Global 6000',
  ],
  [
    'Nurlan Aitmatov', 'naitmatov', 'Almaty', 'Kazakhstan', 43.222, 76.8512, 'UAAA',
    'charter', '2023-04-04',
    'Mining, and a stubborn attempt to make the Tien Shan a ski destination. Year eight.',
    ['ski', 'nature', 'safari'], true,
  ],
  [
    'Adisa Prawirodirdjo', 'aprawiro', 'Jakarta', 'Indonesia', -6.2088, 106.8456, 'WIHH',
    'charter', '2022-08-18',
    'Palm oil in the past tense, marine conservation in the present. Not everyone has forgiven the first.',
    ['nature', 'sailing', 'wellness'], true,
  ],

  // ── The Americas ──────────────────────────────────────────────────────────
  [
    'Louisa Thorne-Baptiste', 'lthornebaptiste', 'New York', 'United States', 40.7128, -74.006, 'KTEB',
    'founding', '2016-06-20',
    'Advises three collections and owns a fourth she never discusses. Ruthless about condition reports.',
    ['art', 'fashion', 'gala'], true, 'Gulfstream G280',
  ],
  [
    'Rosalind Tuckerman', 'rtuckerman', 'Palm Beach', 'United States', 26.7056, -80.0364, 'KPBI',
    'founding', '2017-11-07',
    'Fourth-generation Florida. Runs a tennis foundation and has never lost a set to anyone under fifty.',
    ['tennis', 'golf', 'gala'], false, 'Falcon 2000LXS',
  ],
  [
    'Jasper Wendover', 'jwendover', 'Aspen', 'United States', 39.1911, -106.8175, 'KASE',
    'signature', '2018-01-15',
    'Timber to land trusts. Skis the same three lines all winter and calls it discipline.',
    ['ski', 'nature', 'motorsport'], true, 'Citation CJ3+',
  ],
  [
    'Emil Sandoval-Reinholt', 'esandoval', 'Los Angeles', 'United States', 34.0522, -118.2437, 'KVNY',
    'signature', '2019-06-11',
    'Financed a studio, then a hot-spring hotel in Baja. Only one of them takes his calls.',
    ['film', 'music', 'wellness'], true,
  ],
  [
    'Lucien Havard-Cheng', 'lhavardcheng', 'San Francisco', 'United States', 37.7749, -122.4194, 'KSQL',
    'signature', '2020-08-27',
    'Two hardware companies. Now funds documentaries about the parts of the supply chain he built.',
    ['design', 'film', 'nature'], true, 'Praetor 600',
  ],
  [
    'Gustavo Peñaranda-Muir', 'gpenaranda', 'Miami', 'United States', 25.7617, -80.1918, 'KOPF',
    'charter', '2021-05-02',
    'Music publishing and a marina. Half the catalogue is songs he still cannot listen to.',
    ['music', 'motorsport', 'sailing'], true,
  ],
  [
    'Tomás Rivera-Kellerman', 'trivera', 'Dallas', 'United States', 32.7767, -96.797, 'KDAL',
    'charter', '2022-10-09',
    'Midstream energy. Bought a barbecue institution to stop it closing and now runs it badly.',
    ['golf', 'motorsport', 'culinary'], true,
  ],
  [
    'Harriet Vosburgh-Lyle', 'hvosburgh', 'Jackson', 'United States', 43.4799, -110.7624, 'KJAC',
    'signature', '2018-08-31',
    'Ranch conservation easements. Will happily ruin a dinner party over water rights.',
    ['nature', 'ski', 'equestrian'], false,
  ],
  [
    'Pieter Roosevelt-Kruger', 'prkruger', 'Vancouver', 'Canada', 49.2827, -123.1207, 'CYVR',
    'charter', '2021-12-13',
    'Forestry money into film infrastructure. Heli-skis in April when the guides say not to.',
    ['ski', 'nature', 'film'], true,
  ],
  [
    'Adaeze Okoro-Lambert', 'aokorolambert', 'Toronto', 'Canada', 43.6532, -79.3832, 'CYYZ',
    'charter', '2023-06-15',
    'Pension credit desk. Buys West African photography faster than she can find wall for it.',
    ['art', 'music', 'fashion'], true,
  ],
  [
    'Rafael Quintanilla-Sosa', 'rquintanilla', 'Mexico City', 'Mexico', 19.4326, -99.1332, 'MMTO',
    'signature', '2019-04-09',
    'Agave, then two restaurants, then a film fund. In that order and for the same reason.',
    ['culinary', 'art', 'film'], true, 'Citation Longitude',
  ],
  [
    'Xiomara Betancourt-Iriarte', 'xbetancourt', 'Bogotá', 'Colombia', 4.711, -74.0721, 'SKGY',
    'signature', '2020-11-24',
    'Flowers to logistics. Rides Paso Finos and considers dressage a foreign affectation.',
    ['equestrian', 'culinary', 'nature'], true,
  ],
  [
    'Otto Ferreira-Lindt', 'oferreiralindt', 'São Paulo', 'Brazil', -23.5505, -46.6333, 'SBSP',
    'signature', '2018-04-18',
    'Sugar and ethanol. Sponsored two karting careers, one of which was his own and ended quickly.',
    ['motorsport', 'music', 'culinary'], true, 'Challenger 350',
  ],
  [
    'Isabela Nakagawa-Pires', 'inakagawa', 'Rio de Janeiro', 'Brazil', -22.9068, -43.1729, 'SBJR',
    'charter', '2022-12-05',
    'Third generation Japanese-Brazilian, second generation in shipping. Sails, badly, on purpose.',
    ['music', 'culinary', 'sailing'], true,
  ],
  [
    'Sofía Larrañaga-Moss', 'slarranaga', 'Buenos Aires', 'Argentina', -34.6037, -58.3816, 'SADF',
    'signature', '2019-01-08',
    'Polo ponies and a wine label. The label exists to justify the ponies and everyone knows it.',
    ['equestrian', 'culinary', 'gala'], true, 'Legacy 500',
  ],
  [
    'Pilar Ossandón-Reyes', 'possandon', 'Santiago', 'Chile', -33.4489, -70.6693, 'SCTB',
    'charter', '2021-01-26',
    'Copper by family, Patagonia by choice. Has walked more of it than most of the guides.',
    ['nature', 'ski', 'culinary'], true,
  ],
  [
    'Cristóbal Iturbe-Fonseca', 'citurbe', 'Lima', 'Peru', -12.0464, -77.0428, 'SPJC',
    'charter', '2022-05-23',
    'Fishmeal fortune he is quietly embarrassed by. Funds two archaeological digs to compensate.',
    ['cultural', 'culinary', 'nature'], true,
  ],

  // ── Oceania ───────────────────────────────────────────────────────────────
  [
    'Bianca Ruggeri-Whitlock', 'bruggeri', 'Sydney', 'Australia', -33.8688, 151.2093, 'YSSY',
    'signature', '2019-10-29',
    'Property, then a sailing syndicate. Has finished the Hobart four times and enjoyed none of them.',
    ['sailing', 'wellness', 'nature'], true, 'Falcon 2000LXS',
  ],
  [
    'Angus Pemberton-Reti', 'apemberton', 'Melbourne', 'Australia', -37.8136, 144.9631, 'YMEN',
    'charter', '2021-03-22',
    'Agricultural exports. Turns up at every spring carnival and backs nothing but grey horses.',
    ['equestrian', 'motorsport', 'culinary'], true,
  ],
  [
    'Freya Ashcombe-Nair', 'fashcombe', 'Auckland', 'New Zealand', -36.8485, 174.7633, 'NZAA',
    'signature', '2020-02-06',
    'Marine engineering. Owns a yard that only builds boats the owner intends to sail alone.',
    ['sailing', 'nature', 'wellness'], true,
  ],
  [
    'Tane Whitiora-Blomfield', 'twhitiora', 'Queenstown', 'New Zealand', -45.0312, 168.6626, 'NZQN',
    'charter', '2023-07-27',
    'Heli operation and a lodge with four rooms. Turns away more guests than he takes.',
    ['ski', 'nature', 'safari'], true, 'Pilatus PC-24',
  ],
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// The dossier
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `Member` plus everything a profile needs to read as a person rather than a
 * row.
 *
 * These fields live here rather than in `lib/types.ts` on purpose: that file is
 * the frozen contract every subsystem shares, and none of them — the globe, the
 * buzz engine, the charter model — has any business knowing what languages
 * somebody speaks. `MemberDossier` extends `Member`, so anything typed against
 * `Member` keeps working unchanged and anything that wants the profile asks for
 * the dossier.
 *
 * Every field is optional. A real member record arriving from a real backend
 * with nothing but the `Member` core renders correctly; the profile just has
 * less to say about them.
 */
export interface MemberDossier extends Member {
  /** A real photograph. Absent for the whole simulated roster — see `portrait.ts`. */
  photoUrl?: string;
  age?: number;
  languages?: string[];
  /** Specific. "Runs a Basel gallery", never "entrepreneur". */
  profession?: string;
  /** Two or three places they are known to turn up. */
  signatureSpots?: string[];
  /** ISO 8601. See the note on `SESSION_ANCHOR` below. */
  lastSeenAt?: string;
  tripsThisYear?: number;
  eventsAttended?: number;
  /** Who vouched them in: a member handle, or the founding committee. */
  verifiedBy?: string;
}

/**
 * Compact dossier row, keyed by handle:
 * `[age, languages, profession, signature spots]`.
 *
 * Languages are comma-separated and spots pipe-separated purely so the table
 * stays readable as a table. Every line is written to match the bio above it —
 * the profession is the same fact as the bio, said flat.
 */
type Dossier = readonly [
  age: number,
  languages: string,
  profession: string,
  spots: string,
];

const DOSSIERS: Readonly<Record<string, Dossier>> = {
  // ── Europe ────────────────────────────────────────────────────────────────
  avroche: [61, 'French, English, Italian',
    'Directs the family foundation; sits on two museum boards',
    'Basel, the Tuesday preview|Salle Favart, first night|Villa Medici in June'],
  tmarchetti: [54, 'Italian, English, German',
    'Fourth generation of a Como textile house',
    'Villa d’Este lawn, Saturday|Imola paddock|Bar Basso, after the fair'],
  cashgrove: [57, 'English, French',
    'Breeds event horses in Gloucestershire',
    'Badminton, cross-country day|Hurlingham on a Sunday|Wimbledon, second Wednesday'],
  klindqvist: [49, 'Swedish, English, German',
    'Sold the shipyard, kept the drawing office',
    'Sandhamn, midsummer week|Gothenburg for the Ocean Race stopover|Fiskebäckskil in August'],
  daubusson: [44, 'French, English, Italian',
    'Gallerist in Vieux Nice, hours at her discretion',
    'Porto Cervo in September|Les Voiles de Saint-Tropez|Antibes market, early'],
  areiswitz: [46, 'German, English, Italian',
    'Supplies brake and cooling parts to half the grid',
    'Spa, the bank above Eau Rouge|Kitzbühel, Hahnenkamm Saturday|Goodwood paddock'],
  ivandoorne: [52, 'Dutch, English, German',
    'Buys buildings other developers have written off',
    'Salone, the Rho halls at nine|Zeeland regatta week|PAN Amsterdam'],
  lbaccarini: [41, 'Italian, English',
    'Runs a restaurant group across Rome, Milan and Palermo',
    'Testaccio market before six|Noto in August|The Rome opera gala'],
  dalmeidaserra: [55, 'Portuguese, English, French, Spanish',
    'Cork, then solar, now largely the boat',
    'Cascais, the start line|Comporta in September|Alentejo harvest dinners'],
  fetxeberria: [63, 'Spanish, Basque, English',
    'Bought a links course to keep it a links course',
    'Valderrama in October|San Sebastián, Gastronomika week|Jerez for the historics'],
  sberthierkwon: [58, 'French, English, Korean',
    'Fifth-generation private bank; runs the Geneva book',
    'Verbier in March|Basel, collectors’ preview|Bürgenstock, two weeks in August'],
  rkozlowska: [47, 'Polish, German, English, Italian',
    'Prices catastrophe risk for a reinsurer',
    'Design Miami/Basel|Bad Ragaz, the same suite|Venice in the odd years'],
  imarquardt: [60, 'German, French, English',
    'Fourth generation between a stud farm and a ski lift',
    'Gstaad, the polo weekend|Aachen in July|Saanen ramp on New Year’s Eve'],
  etremaux: [36, 'French, English, Italian',
    'Runs the guiding outfit she used to work for',
    'Courchevel 1850, first lift|La Grave in April|Chamonix for the Kandahar'],
  cdragoi: [59, 'Romanian, German, English, French',
    'Underwrites two opera houses and argues with both',
    'Salzburg, the Felsenreitschule|The Vienna Opera Ball|Bayreuth, when he loses'],
  hbruun: [51, 'Danish, English, German',
    'Furniture, then hotels, now a small foundry',
    '3 Days of Design, Frederiksstaden|Skagen in July|Copenhagen, vegetable season'],
  bhalvorsen: [45, 'Norwegian, English, German',
    'Develops offshore wind — sites them, does not run them',
    'Hardangervidda in August, alone|Hemsedal midweek|Ålesund for the fjord regatta'],
  khalberg: [43, 'Finnish, Swedish, English, Russian',
    'Icebreaker contracts, and a glass house nobody can find',
    'Kilpisjärvi in February|Helsinki Design Week|The Åland archipelago in July'],
  zkarnowska: [39, 'Polish, English, German',
    'Runs a logistics group; holds the interwar poster archive',
    'Warsaw Gallery Weekend|Kraków, the Sukiennice in winter|Sopot in August'],
  jbokonjo: [50, 'French, English, Lingala, Dutch',
    'Commodities lawyer; lends Congolese modernism to anyone who asks properly',
    'Bozar openings|Art Brussels, Thursday|Kinshasa in December'],
  ebalogunreid: [42, 'English, Yoruba, French',
    'Two record labels and a minority stake in a stadium',
    'Notting Hill, the Sunday|Wimbledon, second Friday|Lagos in December'],
  afbyrne: [48, 'English, Irish, Russian',
    'Runs a thoroughbred stud in Kildare',
    'Punchestown, festival week|Ballybunion in September|The Curragh on a Saturday'],
  nrahimivoss: [38, 'German, English, Farsi',
    'Composes film scores; keeps a Steinway in a former substation',
    'Berlinale, the eight a.m. screenings|Donaueschingen|Sylt in October'],
  gpetrossian: [64, 'Greek, Armenian, English, French',
    'Third-generation shipping, dry bulk and tankers',
    'The Tip berth, Monaco|Porto Cervo, Rolex week|Frieze Masters'],
  msalvarezza: [37, 'Italian, Spanish, English',
    'Two clubs and a vineyard that worries him',
    'Formentera, Sunday lunch|Cala d’Hort at sunset|Milan, Salone week'],
  nbencherif: [40, 'French, Arabic, English',
    'Finances first features from a flat above the Croisette',
    'Cannes, the Palais at eight|Marrakech film week|The Lido in September'],
  nachebelaurent: [43, 'French, English, Igbo',
    'Buys couture archives before the houses value them',
    'Paris, the Wednesday shows|Palais Galliera openings|Lagos, Arise week'],
  ykarahan: [56, 'Turkish, English, French',
    'Fourth-generation carpet house, now an auction consultancy',
    'The Grand Bazaar before it opens|Istanbul Biennial|Bodrum in June'],

  // ── Gulf & Levant ─────────────────────────────────────────────────────────
  sbinghurair: [59, 'Arabic, English, French',
    'Runs a ports group; takes the endurance stable more seriously',
    'Dubai World Cup|The Bouthib endurance course|Yas, the Saturday'],
  zoduya: [41, 'Arabic, English, French',
    'Sovereign-fund alumna, now advises private collections',
    'Abu Dhabi Art|Basel, the Tuesday|Aachen in July'],
  yhaddadin: [44, 'Arabic, English, French',
    'Built a museum wing and a fashion week in the same year',
    'M7 openings, Msheireb|Paris couture week|Al Zubarah at dawn'],
  balmuqrin: [47, 'Arabic, English',
    'Family industrials; a workshop of half-finished rally cars',
    'Jeddah, the Corniche circuit|Deauville sales|Diriyah in January'],
  maldossari: [35, 'Arabic, English, French',
    'Third generation in shipping insurance',
    'Paris, the archive sales|Basel in June|Milan, Via Gesù'],
  ralfalasi: [29, 'Arabic, English',
    'Owns the kart circuit he bought at nineteen',
    'Sakhir, night practice|Spa in August|Doha, the late dinners'],
  relkassab: [52, 'Arabic, French, English',
    'Publishes twelve titles a year, half of them poetry',
    'Beirut Art Fair|Batroun in August|The Left Bank in October'],
  dshternberg: [46, 'Hebrew, English, Russian',
    'Sold the second company, still runs the first',
    'Machane Yehuda on a Friday|The Galilee in April|Copenhagen, when the table comes up'],
  lsarraf: [33, 'Arabic, English',
    'Holds the diving concessions on two Red Sea reefs',
    'The Farasan Banks in March|AlUla in winter|Hurghada crossings'],

  // ── Africa ────────────────────────────────────────────────────────────────
  moyelaran: [45, 'English, Yoruba, French',
    'Two record labels and the printing house he mentions first',
    'Lagos in December|Accra, the studio sessions|Paris, the Afro-house week'],
  cnwokolo: [38, 'English, Twi, Igbo',
    'Telecoms towers, then a film fund that backs one picture a year',
    'Chale Wote, Jamestown|Cannes, the market|Lagos in December'],
  iwanjiru: [53, 'Swahili, English, Maa',
    'Runs three conservancies and the lodges that pay for them',
    'Laikipia in the long rains|Lamu in November|Lewa, on foot'],
  amwangi: [44, 'English, Swahili, Afrikaans, Danish',
    'Vineyards in Stellenbosch; funds a marine reserve',
    'Stellenbosch at harvest|De Hoop in whale season|Hermanus in August'],
  tmokoena: [49, 'English, Sesotho, Zulu',
    'Platinum, then private credit',
    'Leopard Creek in December|Sun City, Nedbank week|Franschhoek in March'],
  otazi: [51, 'Arabic, French, English, Tamazight',
    'Restored four riads and sold three',
    'Marrakech, the Thursday souk|Essaouira, Gnaoua week|Fez medina in spring'],
  asesaygrant: [36, 'English, French, Kinyarwanda',
    'Coffee estates, and a design residency above them',
    'Nyungwe in the dry season|Kigali, Ubumuntu week|Lake Kivu in July'],
  fboulahya: [40, 'Arabic, French, English',
    'Phosphates by inheritance, contemporary ceramics by choice',
    '1-54 in Marrakech|The Left Bank galleries|Tangier in September'],

  // ── Asia ──────────────────────────────────────────────────────────────────
  hfujisawa: [55, 'Japanese, English, Spanish',
    'Owns the buildings two Michelin kitchens sit in',
    'The outer market at five|Kyoto in November|Naoshima, off season'],
  smbaek: [42, 'Korean, English, Japanese',
    'Produces four features a year and finishes two',
    'Busan, opening weekend|Seongsu-dong, late|Cannes, the market'],
  whliao: [39, 'Mandarin, English, Japanese',
    'Semiconductors on the family side, a tea house on hers',
    'Alishan, first flush|Taipei Dangdai|Kyoto in April'],
  htanabe: [57, 'English, Japanese, Cantonese, Mandarin',
    'Ran an auction house, now his own advisory',
    'Basel Hong Kong, the Tuesday|Kyoto in November|Sai Kung on Sundays'],
  mlostrowska: [46, 'Mandarin, English, Polish',
    'Built a department store that refuses to stock anything seasonal',
    'West Bund, opening week|Paris in March|Suzhou gardens in the rain'],
  svorapatr: [48, 'Thai, English, French',
    'Six hospitality properties, all of them complained about in writing',
    'Chiang Rai in the cool season|Bangkok, Chinatown after ten|Koh Yao Noi'],
  smistry: [54, 'English, Hindi, Gujarati, Malay',
    'Ran a family office, now runs a golf calendar',
    'Sentosa, the Thursday pro-am|St Andrews in October|Melbourne, sandbelt week'],
  nrsarnaik: [50, 'Marathi, Hindi, English',
    'Second-generation infrastructure — ports and toll roads',
    'Buddh, Friday practice|Wimbledon, first week|Alibaug at the weekend'],
  vchandra: [58, 'Tamil, Hindi, English',
    'Textiles, then a private museum in Jaipur',
    'Jaipur, the literature week|The Rajasthan polo season|Chennai in December'],
  panandavelu: [37, 'Kannada, Tamil, English',
    'Two exits; now funds an ashram she finds ridiculous',
    'Coorg in March|The north end of Goa, off season|Rishikesh in October'],
  rbneve: [41, 'Sinhala, English, Bengali, Dutch',
    'Tea estates, and a dive operation off Trincomalee',
    'Trincomalee, blue whale season|Galle Fort in January|The Baa atoll'],
  jwruan: [52, 'Mandarin, English',
    'Private equity by day, Song ceramics by night',
    'The Poly autumn sales|Mission Hills in November|Kyoto, the temple auctions'],
  naitmatov: [44, 'Kazakh, Russian, English',
    'Mining, and eight years of making the Tien Shan a ski destination',
    'Shymbulak in January|Charyn in May|Verbier, to see how it is done'],
  aprawiro: [47, 'Indonesian, English, Dutch',
    'Palm oil in the past tense, marine conservation in the present',
    'Raja Ampat in October|The Bukit at dawn|Komodo crossings'],

  // ── The Americas ──────────────────────────────────────────────────────────
  lthornebaptiste: [56, 'English, French',
    'Advises three collections and owns a fourth she never mentions',
    'Frieze, the Wednesday|Basel, collectors’ preview|The Costume Institute dinner'],
  rtuckerman: [62, 'English, Spanish',
    'Fourth-generation Florida; runs a tennis foundation',
    'The Open, first Tuesday|Seminole, in season|Newport in July'],
  jwendover: [48, 'English',
    'Turned a timber business into land trusts',
    'Highland Bowl, first tram|Park City, the documentary side|Baja in March'],
  esandoval: [45, 'English, Spanish',
    'Financed a studio, then a hot-spring hotel in Baja',
    'Telluride over Labor Day|Todos Santos in winter|Ojai on Sundays'],
  lhavardcheng: [43, 'English, French, Mandarin',
    'Built two hardware companies; now funds supply-chain documentaries',
    'Sundance, the documentary strand|Big Sur midweek|Milan in April'],
  gpenaranda: [39, 'Spanish, English, Portuguese',
    'Music publishing, and a marina he bought by accident',
    'Miami, race week|Cartagena in January|Ibiza in September'],
  trivera: [51, 'English, Spanish',
    'Midstream energy; owns a barbecue institution he runs badly',
    'Austin, the Friday of the race|Lockhart before noon|Cabo in February'],
  hvosburgh: [53, 'English',
    'Puts ranch land into conservation easements',
    'The elk refuge in January|Teton Pass at first light|The Rock Springs sales'],
  prkruger: [46, 'English, Afrikaans, French',
    'Forestry money into film infrastructure',
    'Bella Coola in April|Toronto, the first weekend|Whistler midweek'],
  aokorolambert: [34, 'English, French, Igbo',
    'Runs a pension fund’s private credit desk',
    'The Toronto Biennial|Lagos in December|Paris Photo'],
  rquintanilla: [49, 'Spanish, English',
    'Agave, two restaurants and a film fund, in that order',
    'Oaxaca in November|Morelia, film week|Valle de Guadalupe at harvest'],
  xbetancourt: [42, 'Spanish, English, Portuguese',
    'Took a flower export business into logistics',
    'Medellín, the flower fair|Cartagena in January|The Llanos, Paso trials'],
  oferreiralindt: [47, 'Portuguese, English, German',
    'Sugar and ethanol; sponsored two karting careers, one his own',
    'Interlagos, race Sunday|Trancoso in January|Rio, the long Sunday lunch'],
  inakagawa: [36, 'Portuguese, English, Japanese',
    'Third-generation Japanese-Brazilian, second in coastal shipping',
    'Angra dos Reis in February|Lapa, the late sets|Búzios, regatta week'],
  slarranaga: [44, 'Spanish, English, French',
    'Breeds polo ponies; the wine label pays for them',
    'Palermo, the Open final|Mendoza at harvest|José Ignacio in January'],
  possandon: [40, 'Spanish, English',
    'Copper by family, Patagonia by choice',
    'Torres del Paine in November|Portillo in August|Chiloé in February'],
  citurbe: [45, 'Spanish, English, Quechua',
    'Fishmeal fortune; funds two digs by way of apology',
    'Barranco, the late tables|Chachapoyas in the dry season|Cusco in June'],

  // ── Oceania ───────────────────────────────────────────────────────────────
  bruggeri: [43, 'English, Italian',
    'Property, then a sailing syndicate that eats the profit',
    'Boxing Day, off the Heads|Hobart, the Customs House dock|Byron midweek'],
  apemberton: [50, 'English, Māori',
    'Exports agricultural machinery across the Pacific',
    'Flemington, spring carnival|Albert Park on the Saturday|The Peninsula in February'],
  fashcombe: [41, 'English, Māori, Malayalam',
    'Marine engineer; her yard only builds single-handers',
    'Waiheke over New Year|Bay of Islands in March|Auckland, the regatta start'],
  twhitiora: [38, 'English, Māori',
    'Runs a heli operation and a four-room lodge',
    'The Remarkables at first light|Fiordland in March|Wanaka, the shoulder weeks'],
};

/**
 * `lastSeenAt` is the one field here that is a function of the wall clock, and
 * it is computed once at module evaluation rather than per read.
 *
 * The offset itself is hashed from the handle, so the *ordering* of who was
 * around most recently never changes; only the anchor moves. Nothing rendered
 * during SSR reads it — presence only appears inside the profile sheet, which
 * is mounted by a click — so it cannot produce a hydration mismatch, and it
 * means a member is never "last seen 400 days ago" because the file is old.
 */
const SESSION_ANCHOR = Date.now();

const idFor = (handle: string): string => `m-${handle}`;

/** Founding members are the pool everyone else was vouched in from. */
const FOUNDING_HANDLES: readonly string[] = ROWS.filter((r) => r[7] === 'founding').map(
  (r) => r[1],
);

/**
 * Membership by referral is the entire texture of a club like this, so it is
 * modelled rather than decorated: founding members came in with the house, and
 * everybody else has a name attached to them. Derived from the handle so the
 * chain is stable and always points at somebody who actually exists.
 */
function vouchedBy(handle: string, tier: MemberTier): string {
  if (tier === 'founding') return 'Founding committee';
  const pool = FOUNDING_HANDLES.filter((h) => h !== handle);
  const pick = pool[hashSeed(`vouch:${handle}`) % pool.length];
  return pick ? `@${pick}` : 'Founding committee';
}

function expand(row: Row): MemberDossier {
  const [
    name,
    handle,
    city,
    country,
    lat,
    lon,
    port,
    tier,
    since,
    bio,
    interests,
    openToJetShare,
    aircraft,
  ] = row;

  // Verification is a house function, not a coin flip: founding and signature
  // members were vouched for at intake, charter members mostly still are but
  // some have not sat for it. Derived from the handle so it never changes.
  const verified = tier !== 'charter' || hashSeed(`verify:${handle}`) % 3 !== 0;

  const dossier = DOSSIERS[handle];
  const rand = mulberry32(hashSeed(`dossier:${handle}`));

  // How much they actually move. Owning the metal roughly doubles it, and rank
  // correlates because the people who have been here longest go to more.
  const tierLift = tier === 'founding' ? 1.35 : tier === 'signature' ? 1 : 0.72;
  const tripsThisYear = Math.max(
    1,
    Math.round((2 + rand() * 7) * tierLift * (aircraft ? 1.45 : 1)),
  );

  // A running total since intake, at a plausible rate per year.
  const years = Math.max(0.5, (Date.parse('2026-07-26') - Date.parse(since)) / 31_557_600_000);
  const eventsAttended = Math.round(years * (3 + rand() * 6) * tierLift) + 2;

  // Presence: most of the club has been in this week, a long tail has not.
  const hoursAgo = Math.round(Math.pow(rand(), 2.4) * 640) + 1;

  return {
    id: idFor(handle),
    handle,
    name,
    avatarSeed: `${handle}::${since}`,
    homeBase: { city, country, coords: { lat, lon }, homeJetPort: port },
    tier,
    memberSince: since,
    verified,
    bio,
    interests: [...interests],
    openToJetShare,
    ...(aircraft ? { aircraft } : {}),
    ...(dossier
      ? {
          age: dossier[0],
          languages: dossier[1].split(',').map((s) => s.trim()),
          profession: dossier[2],
          signatureSpots: dossier[3].split('|').map((s) => s.trim()),
        }
      : {}),
    tripsThisYear,
    eventsAttended,
    lastSeenAt: new Date(SESSION_ANCHOR - hoursAgo * 3_600_000).toISOString(),
    verifiedBy: vouchedBy(handle, tier),
  };
}

/** The full roster. Order is stable and is the tie-break for every sort. */
export const MEMBERS: readonly MemberDossier[] = ROWS.map(expand);

/** `id` → `Member`. The only sanctioned way to resolve a member reference. */
export const MEMBER_INDEX: ReadonlyMap<string, MemberDossier> = new Map(
  MEMBERS.map((m) => [m.id, m]),
);

/** `handle` → `Member`, for @-mention style lookups. */
export const MEMBER_BY_HANDLE: ReadonlyMap<string, MemberDossier> = new Map(
  MEMBERS.map((m) => [m.handle, m]),
);

/** Never throws — returns `undefined` for an unknown id, callers decide. */
export const getMember = (id: string): MemberDossier | undefined => MEMBER_INDEX.get(id);

/**
 * Resolve a `verifiedBy` value back to a member. Returns `undefined` for the
 * founding committee, which is a body rather than a person.
 */
export const resolveVoucher = (verifiedBy: string | undefined): MemberDossier | undefined =>
  verifiedBy?.startsWith('@') ? MEMBER_BY_HANDLE.get(verifiedBy.slice(1)) : undefined;

/** Members who own an aircraft and will put strangers in the back of it. */
export const JET_OWNERS: readonly MemberDossier[] = MEMBERS.filter(
  (m) => Boolean(m.aircraft) && m.openToJetShare,
);

/**
 * The signed-in user. Distinct from the roster — a real record with a real home
 * base, editable in the profile sheet, and never a peer of themselves.
 * `useSocialStore` seeds from this and persists any edits.
 */
export const YOU: MemberDossier = {
  id: 'me',
  handle: 'you',
  name: 'You',
  avatarSeed: 'meridian::self',
  homeBase: {
    city: 'New York',
    country: 'United States',
    coords: { lat: 40.7128, lon: -74.006 },
    homeJetPort: 'KTEB',
  },
  tier: 'signature',
  memberSince: '2024-11-02',
  verified: true,
  bio: '',
  interests: ['art', 'motorsport', 'culinary'],
  openToJetShare: true,
  // You did not sign up. Somebody put their name to you, and the register says
  // whose — the same rule as everybody else on it.
  verifiedBy: '@lthornebaptiste',
};

// ─────────────────────────────────────────────────────────────────────────────
// Gateways
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where a member keeps the aircraft.
 *
 * A scrolling list of airports was the wrong shape for this question: nobody
 * wants to hunt for their own city in an index. The answer is a name — "Miami",
 * "Teterboro", "KTEB", "Côte d'Azur" — resolved to the field a private aircraft
 * would actually use.
 *
 * Coordinates, names and FBO quality come from the shared registry in
 * `lib/data/events/airports.ts`, which is real data. The city, country and the
 * search aliases are curated here, because the registry is a list of runways
 * and a member's home base is a place.
 */
export interface Gateway {
  /** ICAO. */
  code: string;
  /** The field's own name, e.g. "Paris–Le Bourget". */
  name: string;
  city: string;
  country: string;
  coords: GeoPoint;
  fboQuality: Airport['fboQuality'];
  /** Everything this field can be found by, lowercased. */
  aliases: readonly string[];
}

/** `ICAO: 'City|Country|alias,alias'` — aliases beyond the city and the name. */
const GATEWAY_PLACES: Readonly<Record<string, string>> = {
  // Europe
  LFPB: 'Paris|France|le bourget,lbg,ile-de-france',
  LFMN: 'Nice|France|cote d azur,côte d’azur,french riviera,monaco,nce,antibes',
  LFMD: 'Cannes|France|croisette,mandelieu,french riviera,cеq',
  LFTZ: 'Saint-Tropez|France|la mole,ramatuelle,pampelonne',
  LFLB: 'Courchevel|France|chambery,savoie,three valleys,meribel,val d isere',
  LSGG: 'Geneva|Switzerland|genève,gva,lake geneva,verbier,chamonix',
  LSZH: 'Zurich|Switzerland|zrh,zürich',
  LSZS: 'St. Moritz|Switzerland|samedan,engadin,engadine,st moritz,saint moritz',
  LSGK: 'Gstaad|Switzerland|saanen,bernese oberland',
  LSZA: 'Lugano|Switzerland|ticino,lake como south',
  LOWW: 'Vienna|Austria|wien,schwechat,vie',
  LOWI: 'Innsbruck|Austria|tyrol,tirol,kitzbuhel,kitzbühel,st anton',
  EDMO: 'Munich|Germany|münchen,oberpfaffenhofen,bavaria,bayern',
  EDDB: 'Berlin|Germany|brandenburg,ber',
  EGLF: 'London|United Kingdom|farnborough,fab,surrey,south west london',
  EGGW: 'Luton|United Kingdom|london luton,ltn,hertfordshire',
  EGKB: 'Biggin Hill|United Kingdom|london biggin hill,bqh,kent',
  EIDW: 'Dublin|Ireland|leinster,kildare,dub',
  LIML: 'Milan|Italy|milano,linate,lombardy,lin,como',
  LIRA: 'Rome|Italy|roma,ciampino,lazio',
  LIPZ: 'Venice|Italy|venezia,veneto,marco polo,vce',
  LIQS: 'Siena|Italy|tuscany,toscana,chianti,val d orcia',
  LIEO: 'Porto Cervo|Italy|olbia,costa smeralda,sardinia,sardegna,obl',
  LEIB: 'Ibiza|Spain|eivissa,formentera,balearics,ibz',
  LEPA: 'Palma|Spain|mallorca,majorca,balearics,pmi',
  LECU: 'Madrid|Spain|cuatro vientos,castile',
  LEMG: 'Marbella|Spain|malaga,málaga,costa del sol,sotogrande,agp',
  LPCS: 'Lisbon|Portugal|lisboa,cascais,comporta,estoril',
  LGAV: 'Athens|Greece|athina,attica,ath',
  LGMK: 'Mykonos|Greece|cyclades,jmk,paros',
  LTBA: 'Istanbul|Türkiye|turkey,bosphorus,ataturk,atatürk',
  EHRD: 'Rotterdam|Netherlands|amsterdam,the hague,den haag,randstad',
  EBBR: 'Brussels|Belgium|bruxelles,brussel,bru',
  EKCH: 'Copenhagen|Denmark|kobenhavn,københavn,kastrup,cph',
  ESSB: 'Stockholm|Sweden|bromma,archipelago,bma',
  ENBR: 'Bergen|Norway|fjords,hordaland,bgo',
  BIRK: 'Reykjavík|Iceland|reykjavik,rkv,iceland',
  LKPR: 'Prague|Czechia|praha,prg,bohemia',
  // Gulf, Levant, Africa
  OMDW: 'Dubai|United Arab Emirates|al maktoum,dwc,jebel ali',
  OMAD: 'Abu Dhabi|United Arab Emirates|al bateen,azi,yas',
  OTHH: 'Doha|Qatar|hamad,doh,qatar',
  OEJN: 'Jeddah|Saudi Arabia|red sea,alula,jed',
  OERK: 'Riyadh|Saudi Arabia|diriyah,ruh',
  OOMS: 'Muscat|Oman|mct,oman',
  GMMX: 'Marrakech|Morocco|marrakesh,menara,rak,atlas',
  HKNW: 'Nairobi|Kenya|wilson,laikipia,maasai mara,masai mara',
  HTKJ: 'Kilimanjaro|Tanzania|arusha,serengeti,ngorongoro,jro',
  HRYR: 'Kigali|Rwanda|nyungwe,volcanoes,kgl',
  FALA: 'Johannesburg|South Africa|lanseria,hla,sandton,gauteng',
  FACT: 'Cape Town|South Africa|western cape,stellenbosch,franschhoek,cpt',
  FSIA: 'Mahé|Seychelles|seychelles,mahe,praslin,sez',
  FIMP: 'Port Louis|Mauritius|mauritius,mru',
  // Asia-Pacific
  RJTT: 'Tokyo|Japan|haneda,hnd,kanto',
  RJOO: 'Kyoto|Japan|osaka,itami,kansai,itm',
  RKSS: 'Seoul|South Korea|gimpo,kimpo,gmp',
  VHHH: 'Hong Kong|Hong Kong SAR|hkg,kowloon',
  ZSPD: 'Shanghai|China|pudong,pvg,jiangnan',
  WSSL: 'Singapore|Singapore|seletar,xsp',
  VTBD: 'Bangkok|Thailand|don mueang,dmk,krung thep',
  VIDP: 'Delhi|India|new delhi,ncr,gurgaon,del',
  VABB: 'Mumbai|India|bombay,juhu,bom',
  VOCI: 'Kochi|India|kerala,cochin,cok',
  VCBI: 'Colombo|Sri Lanka|ceylon,galle,cmb',
  VRMM: 'Malé|Maldives|maldives,male,mle,baa atoll',
  WADD: 'Bali|Indonesia|denpasar,ngurah rai,dps,jakarta',
  // The Americas
  KTEB: 'New York|United States|teterboro,teb,nyc,manhattan,hamptons',
  KHPN: 'Westchester|United States|white plains,hpn,greenwich,connecticut',
  KVNY: 'Los Angeles|United States|van nuys,vny,la,malibu,beverly hills',
  KOPF: 'Miami|United States|opa locka,opf,south beach,coconut grove',
  KPBI: 'Palm Beach|United States|west palm,pbi,jupiter,wellington',
  KASE: 'Aspen|United States|pitkin,ase,snowmass,roaring fork',
  KEGE: 'Vail|United States|eagle county,ege,beaver creek',
  KJAC: 'Jackson|United States|jackson hole,jac,teton,wyoming',
  KACK: 'Nantucket|United States|ack,cape cod,marthas vineyard',
  KSAF: 'Santa Fe|United States|saf,new mexico,taos',
  KADS: 'Dallas|United States|addison,ads,texas',
  KHOU: 'Houston|United States|hobby,hou,texas',
  KSLC: 'Park City|United States|salt lake,slc,deer valley,utah',
  KMRY: 'Monterey|United States|carmel,pebble beach,big sur,mry',
  KPSP: 'Palm Springs|United States|psp,coachella,la quinta',
  CYTZ: 'Toronto|Canada|billy bishop,ytz,ontario',
  CYVR: 'Vancouver|Canada|yvr,whistler,british columbia',
  MMTO: 'Mexico City|Mexico|toluca,cdmx,tlc',
  MMSD: 'Los Cabos|Mexico|cabo,san jose del cabo,sjd,baja',
  MMUN: 'Cancún|Mexico|cancun,tulum,riviera maya,cun',
  MYNN: 'Nassau|Bahamas|bahamas,nas,harbour island',
  TFFJ: 'St Barthélemy|France|st barths,saint barth,sbh,gustavia',
  SBSP: 'São Paulo|Brazil|sao paulo,congonhas,cgh',
  SBJR: 'Rio de Janeiro|Brazil|rio,jacarepagua,ipanema',
  SADP: 'Buenos Aires|Argentina|san fernando,palermo,pampas',
  SAME: 'Mendoza|Argentina|uco valley,andes',
  SCEL: 'Santiago|Chile|scl,patagonia,chile',
  SPJC: 'Lima|Peru|lim,barranco,cusco',
  // Oceania
  YSSY: 'Sydney|Australia|syd,new south wales,bondi',
  YMEN: 'Melbourne|Australia|essendon,meb,victoria,mornington',
  NZQN: 'Queenstown|New Zealand|zqn,wanaka,southern lakes,otago',
};

/** Every gateway a member can be based at, in registry order. */
export const GATEWAYS: readonly Gateway[] = AIRPORTS.filter(
  (a) => GATEWAY_PLACES[a.code] !== undefined,
).map((a) => {
  const [city = a.name, country = '', aliasList = ''] = (GATEWAY_PLACES[a.code] ?? '').split('|');
  const aliases = [
    city.toLowerCase(),
    country.toLowerCase(),
    a.name.toLowerCase(),
    a.code.toLowerCase(),
    ...aliasList.split(',').map((s) => s.trim().toLowerCase()),
  ].filter((s) => s.length > 0);
  return {
    code: a.code,
    name: a.name,
    city,
    country,
    coords: a.coords,
    fboQuality: a.fboQuality,
    aliases: [...new Set(aliases)],
  };
});

export const GATEWAY_INDEX: ReadonlyMap<string, Gateway> = new Map(
  GATEWAYS.map((g) => [g.code, g]),
);

const FBO_RANK: Record<Airport['fboQuality'], number> = {
  exceptional: 2,
  excellent: 1,
  adequate: 0,
};

export interface GatewayMatch {
  gateway: Gateway;
  /** Higher is better. Only meaningful relative to the other matches. */
  score: number;
  /** Which alias matched, so the UI can show *why* this is the answer. */
  matched: string;
}

/**
 * Fuzzy gateway search.
 *
 * Ranked rather than filtered, because the useful answer to "miami" is
 * Opa-locka and the useful answer to "kteb" is Teterboro, and a naive substring
 * filter gets neither. Scoring, in order of confidence: the exact ICAO, a
 * prefix of an alias, a word inside an alias, then a loose subsequence for
 * typos. Ties break toward the better-served field — if two gateways are
 * equally plausible you want the one with three FBOs and no slot problem.
 */
export function searchGateways(query: string, limit = 5): GatewayMatch[] {
  const q = normalize(query);
  if (q.length === 0) return [];

  const out: GatewayMatch[] = [];
  for (const gateway of GATEWAYS) {
    let best = 0;
    let matched = '';
    for (const alias of gateway.aliases) {
      const a = normalize(alias);
      if (!a) continue;
      let s = 0;
      if (a === q) s = 100;
      else if (a.startsWith(q)) s = 82 - Math.min(20, a.length - q.length);
      else if (wordStarts(a, q)) s = 70;
      else if (a.includes(q)) s = 52;
      // Typo tolerance, but only when the first letter agrees — otherwise
      // "miami" quietly matches "roMe cIAMpIno" and the list fills with noise.
      else if (q.length >= 4 && startsSameLetter(a, q) && isSubsequence(q, a)) s = 26;
      if (s > best) {
        best = s;
        matched = alias;
      }
    }
    if (best > 0) out.push({ gateway, score: best + FBO_RANK[gateway.fboQuality], matched });
  }

  return out
    .sort((a, b) => b.score - a.score || a.gateway.city.localeCompare(b.gateway.city))
    .slice(0, limit);
}

/** Nearest gateway to a point, great-circle. What geolocation resolves through. */
export function nearestGateway(coords: GeoPoint): Gateway {
  let best = GATEWAYS[0]!;
  let bestD = Number.POSITIVE_INFINITY;
  for (const g of GATEWAYS) {
    const d = greatCircleDistanceNm(coords, g.coords);
    if (d < bestD) {
      bestD = d;
      best = g;
    }
  }
  return best;
}

/** Distance from a point to a gateway, in nautical miles. */
export const distanceToGateway = (coords: GeoPoint, gateway: Gateway): number =>
  Math.round(greatCircleDistanceNm(coords, gateway.coords));

/** A gateway as a member's home base. Coordinates are the field's, not the city's. */
export const toHomeBase = (gateway: Gateway): Member['homeBase'] => ({
  city: gateway.city,
  country: gateway.country,
  coords: gateway.coords,
  homeJetPort: gateway.code,
});

/** Resolve whatever a member has stored back to a gateway record, if we know it. */
export const gatewayFor = (homeJetPort: string): Gateway | undefined =>
  GATEWAY_INDEX.get(homeJetPort.toUpperCase());

/** Strip accents and punctuation so "Côte d’Azur" and "cote dazur" both land. */
function normalize(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when `q` starts any word of `a` — "hole" matches "jackson hole". */
function wordStarts(a: string, q: string): boolean {
  return a.split(' ').some((word) => word.startsWith(q));
}

/** Any word of `a` begins with the first character of `q`. */
function startsSameLetter(a: string, q: string): boolean {
  const first = q[0];
  return first !== undefined && a.split(' ').some((word) => word.startsWith(first));
}

/** Loose typo tolerance: every character of `q` appears in `a`, in order. */
function isSubsequence(q: string, a: string): boolean {
  let i = 0;
  for (const ch of a) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return false;
}

/**
 * The shortlist offered before anyone types — the fields the membership
 * actually keeps aircraft on. Search reaches the rest.
 */
const SHORTLIST = [
  'KTEB', 'KVNY', 'KOPF', 'KASE', 'EGLF', 'LFPB', 'LSGG', 'LSZS', 'LFMN',
  'LIML', 'LEIB', 'OMDW', 'VABB', 'WSSL', 'VHHH', 'RJTT', 'SBSP', 'FACT', 'YSSY',
] as const;

/**
 * Home bases offered without a query. Kept as `Member['homeBase']` because that
 * is what the store stores; `GATEWAYS` is the richer form.
 */
export const HOME_BASE_OPTIONS: readonly Member['homeBase'][] = SHORTLIST.map((code) =>
  toHomeBase(GATEWAY_INDEX.get(code)!),
);
