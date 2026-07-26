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

import type { EventCategory, Member, MemberTier } from '@/lib/types';
import { hashSeed } from './rng';

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

const idFor = (handle: string): string => `m-${handle}`;

function expand(row: Row): Member {
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
  };
}

/** The full roster. Order is stable and is the tie-break for every sort. */
export const MEMBERS: readonly Member[] = ROWS.map(expand);

/** `id` → `Member`. The only sanctioned way to resolve a member reference. */
export const MEMBER_INDEX: ReadonlyMap<string, Member> = new Map(
  MEMBERS.map((m) => [m.id, m]),
);

/** `handle` → `Member`, for @-mention style lookups. */
export const MEMBER_BY_HANDLE: ReadonlyMap<string, Member> = new Map(
  MEMBERS.map((m) => [m.handle, m]),
);

/** Never throws — returns `undefined` for an unknown id, callers decide. */
export const getMember = (id: string): Member | undefined => MEMBER_INDEX.get(id);

/** Members who own an aircraft and will put strangers in the back of it. */
export const JET_OWNERS: readonly Member[] = MEMBERS.filter(
  (m) => Boolean(m.aircraft) && m.openToJetShare,
);

/**
 * The signed-in user. Distinct from the roster — a real record with a real home
 * base, editable in the profile sheet, and never a peer of themselves.
 * `useSocialStore` seeds from this and persists any edits.
 */
export const YOU: Member = {
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
};

/**
 * Home bases offered in the profile sheet. A short, opinionated list — the
 * fields members actually keep aircraft on, not an airport database.
 */
export const HOME_BASE_OPTIONS: readonly Member['homeBase'][] = [
  { city: 'New York', country: 'United States', coords: { lat: 40.7128, lon: -74.006 }, homeJetPort: 'KTEB' },
  { city: 'Los Angeles', country: 'United States', coords: { lat: 34.0522, lon: -118.2437 }, homeJetPort: 'KVNY' },
  { city: 'Miami', country: 'United States', coords: { lat: 25.7617, lon: -80.1918 }, homeJetPort: 'KOPF' },
  { city: 'Aspen', country: 'United States', coords: { lat: 39.1911, lon: -106.8175 }, homeJetPort: 'KASE' },
  { city: 'London', country: 'United Kingdom', coords: { lat: 51.5074, lon: -0.1278 }, homeJetPort: 'EGLF' },
  { city: 'Paris', country: 'France', coords: { lat: 48.8566, lon: 2.3522 }, homeJetPort: 'LFPB' },
  { city: 'Geneva', country: 'Switzerland', coords: { lat: 46.2044, lon: 6.1432 }, homeJetPort: 'LSGG' },
  { city: 'St. Moritz', country: 'Switzerland', coords: { lat: 46.4908, lon: 9.8355 }, homeJetPort: 'LSZS' },
  { city: 'Monaco', country: 'Monaco', coords: { lat: 43.7384, lon: 7.4246 }, homeJetPort: 'LFMN' },
  { city: 'Milan', country: 'Italy', coords: { lat: 45.4642, lon: 9.19 }, homeJetPort: 'LIML' },
  { city: 'Ibiza', country: 'Spain', coords: { lat: 38.9067, lon: 1.4206 }, homeJetPort: 'LEIB' },
  { city: 'Dubai', country: 'United Arab Emirates', coords: { lat: 25.2048, lon: 55.2708 }, homeJetPort: 'OMDW' },
  { city: 'Mumbai', country: 'India', coords: { lat: 19.076, lon: 72.8777 }, homeJetPort: 'VABB' },
  { city: 'Singapore', country: 'Singapore', coords: { lat: 1.3521, lon: 103.8198 }, homeJetPort: 'WSSL' },
  { city: 'Hong Kong', country: 'Hong Kong SAR', coords: { lat: 22.3193, lon: 114.1694 }, homeJetPort: 'VHHH' },
  { city: 'Tokyo', country: 'Japan', coords: { lat: 35.6762, lon: 139.6503 }, homeJetPort: 'RJTT' },
  { city: 'São Paulo', country: 'Brazil', coords: { lat: -23.5505, lon: -46.6333 }, homeJetPort: 'SBSP' },
  { city: 'Cape Town', country: 'South Africa', coords: { lat: -33.9249, lon: 18.4241 }, homeJetPort: 'FACT' },
  { city: 'Sydney', country: 'Australia', coords: { lat: -33.8688, lon: 151.2093 }, homeJetPort: 'YSSY' },
];
