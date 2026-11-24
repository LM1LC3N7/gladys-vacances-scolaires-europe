// -----------------------------------------------------------------------------
// Fixed values of the integration: the API, its bounds, the countries offered.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

/** The version of this integration, from package.json (copied in the image). */
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const VERSION = pkg.version;
export const REPO_URL = 'https://github.com/LM1LC3N7/gladys-vacances-scolaires-europe';
export const USER_AGENT = `gladys-vacances-scolaires-europe/${VERSION} (+${REPO_URL})`;

export const API_URL = 'https://openholidaysapi.org';
export const SOURCE_URL = 'https://www.openholidaysapi.org';

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

// The school holidays of a region are read once a day at most (the source
// changes a few times a year); the region lists once a week.
export const HOLIDAYS_TTL = DAY;
export const CATALOG_TTL = 7 * DAY;
// Every hour the app checks what is due (no request when nothing is).
export const CHECK_EVERY = HOUR;
// A failed read pauses every request to the API: 60 s, doubled, 6 h at most.
export const PAUSE_MIN = MINUTE;
export const PAUSE_MAX = 6 * HOUR;
// A read started less than a minute ago (before a restart) is not started again.
export const ATTEMPT_GAP = MINUTE;
// Gladys refused or could not be reached: retried every 10 s to 5 min.
export const GLADYS_RETRY_MIN = 10 * SECOND;
export const GLADYS_RETRY_MAX = 5 * MINUTE;

export const REQUEST_TIMEOUT = 20 * SECOND;
export const MAX_HOLIDAYS_BYTES = 1024 * 1024;
export const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
export const MAX_HOLIDAYS_PER_REGION = 500;
export const MAX_CATALOG_ENTRIES = 5000;

// Gladys accepts 30 calendar writes a minute per integration: 25 at most here.
export const WRITES_PER_MINUTE = 25;
export const WRITE_WINDOW = MINUTE;
// A 429 of Gladys: one more try after a minute, then the next check.
export const GLADYS_429_WAIT = MINUTE;

// What a user may ask: up to 3 regions, 200 characters in all.
export const MAX_REGIONS = 3;
export const MAX_REGIONS_TEXT = 200;
// The window published: from the 1st of the current month, 13 months ahead.
export const WINDOW_MONTHS = 13;

export const CALENDAR_COLOR = '#2a9d8f';

export const ACTIONS = { LIST_REGIONS: 'list_regions' };

// Countries with school holidays in OpenHolidays, France excluded (the French
// school holidays are covered by gladys-holidays). Names in English and French.
export const COUNTRIES = [
  { code: 'AD', en: 'Andorra', fr: 'Andorre' },
  { code: 'AL', en: 'Albania', fr: 'Albanie' },
  { code: 'AT', en: 'Austria', fr: 'Autriche' },
  { code: 'BE', en: 'Belgium', fr: 'Belgique' },
  { code: 'BG', en: 'Bulgaria', fr: 'Bulgarie' },
  { code: 'BY', en: 'Belarus', fr: 'Biélorussie' },
  { code: 'CH', en: 'Switzerland', fr: 'Suisse' },
  { code: 'CZ', en: 'Czechia', fr: 'Tchéquie' },
  { code: 'DE', en: 'Germany', fr: 'Allemagne' },
  { code: 'EE', en: 'Estonia', fr: 'Estonie' },
  { code: 'ES', en: 'Spain', fr: 'Espagne' },
  { code: 'HR', en: 'Croatia', fr: 'Croatie' },
  { code: 'HU', en: 'Hungary', fr: 'Hongrie' },
  { code: 'IE', en: 'Ireland', fr: 'Irlande' },
  { code: 'IT', en: 'Italy', fr: 'Italie' },
  { code: 'LI', en: 'Liechtenstein', fr: 'Liechtenstein' },
  { code: 'LT', en: 'Lithuania', fr: 'Lituanie' },
  { code: 'LU', en: 'Luxembourg', fr: 'Luxembourg' },
  { code: 'LV', en: 'Latvia', fr: 'Lettonie' },
  { code: 'MC', en: 'Monaco', fr: 'Monaco' },
  { code: 'MD', en: 'Moldova', fr: 'Moldavie' },
  { code: 'MT', en: 'Malta', fr: 'Malte' },
  { code: 'NL', en: 'Netherlands', fr: 'Pays-Bas' },
  { code: 'PL', en: 'Poland', fr: 'Pologne' },
  { code: 'PT', en: 'Portugal', fr: 'Portugal' },
  { code: 'RO', en: 'Romania', fr: 'Roumanie' },
  { code: 'RS', en: 'Serbia', fr: 'Serbie' },
  { code: 'SI', en: 'Slovenia', fr: 'Slovénie' },
  { code: 'SK', en: 'Slovakia', fr: 'Slovaquie' },
  { code: 'SM', en: 'San Marino', fr: 'Saint-Marin' },
];

export const COUNTRY_CODES = new Set(COUNTRIES.map((c) => c.code));
export const countryOf = (code) => COUNTRIES.find((c) => c.code === code);
