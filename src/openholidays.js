// -----------------------------------------------------------------------------
// The OpenHolidays API (https://www.openholidaysapi.org, data ODbL-1.0): the
// school holidays of a country or of one of its regions, and the lists of
// regions (subdivisions and groups). The answers are never trusted: bounded in
// size and duration (src/http.js), every entry checked, the unknown dropped.
// Nothing of the API is embedded: it is called.
// -----------------------------------------------------------------------------

import {
  API_URL,
  MAX_CATALOG_BYTES,
  MAX_CATALOG_ENTRIES,
  MAX_HOLIDAYS_BYTES,
  MAX_HOLIDAYS_PER_REGION,
  REQUEST_TIMEOUT,
} from './constants.js';
import { HttpError, getJson } from './http.js';
import { daysBetween, isDate } from './time.js';

const LANG = /^[A-Z]{2}$/;
const CODE = /^[A-Z]{2}(?:-[A-Z0-9]{1,8}){0,3}$/;
const ID = /^[A-Za-z0-9-]{1,64}$/;
const MAX_TEXT = 300;
// A school holiday longer than this is not a holiday (summer is ~10 weeks).
const MAX_HOLIDAY_DAYS = 120;

/** `[{ language, text }]` -> `{ EN: 'Christmas', DE: 'Weihnachten' }` (bounded). */
export function readTexts(list) {
  const out = {};
  if (!Array.isArray(list)) return out;
  for (const entry of list.slice(0, 20)) {
    const lang = typeof entry?.language === 'string' ? entry.language.toUpperCase() : '';
    const text = typeof entry?.text === 'string' ? clean(entry.text) : '';
    if (LANG.test(lang) && text && !(lang in out)) out[lang] = text;
  }
  return out;
}

/** One line, no control character, bounded. */
export function clean(text) {
  return (
    String(text)
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_TEXT)
  );
}

/**
 * The text of `texts` in `language` (upper case), else the first one given by
 * the API (the local language: "Bayern", "Weihnachtsferien"), else ''.
 */
export function pick(texts, language) {
  if (!texts) return '';
  return texts[language] ?? Object.values(texts)[0] ?? '';
}

/**
 * The school holidays of an answer, checked: `[{ id, start, end, names,
 * comments, halfDay }]` (end inclusive), type "School" only (the back-to-school
 * and end-of-lessons days are not holidays). Throws when the answer is not a
 * list or holds more than MAX_HOLIDAYS_PER_REGION entries.
 */
export function parseHolidays(data) {
  if (!Array.isArray(data)) throw new HttpError('parse', 'not a list of holidays');
  if (data.length > MAX_HOLIDAYS_PER_REGION) throw new HttpError('parse', 'too many holidays');
  const out = [];
  const seen = new Set();
  for (const h of data) {
    if (!h || typeof h !== 'object' || Array.isArray(h)) continue;
    if (h.type !== 'School') continue;
    if (typeof h.id !== 'string' || !ID.test(h.id) || seen.has(h.id)) continue;
    if (!isDate(h.startDate) || !isDate(h.endDate) || h.endDate < h.startDate) continue;
    if (daysBetween(h.startDate, h.endDate) > MAX_HOLIDAY_DAYS) continue;
    const names = readTexts(h.name);
    if (Object.keys(names).length === 0) continue;
    seen.add(h.id);
    out.push({
      id: h.id,
      start: h.startDate,
      end: h.endDate,
      names,
      comments: readTexts(h.comment),
      halfDay: h.temporalScope === 'HalfDay',
    });
  }
  out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1));
  return out;
}

/**
 * The regions of a country from the Subdivisions and Groups answers:
 * `[{ code, names, top, group }]`, `top` for a first-level subdivision,
 * `group` for a group (Belgian communities, Dutch regions, Swiss school
 * regions). Children are walked 3 levels deep, MAX_CATALOG_ENTRIES at most.
 */
export function parseCatalog(country, subdivisions, groups) {
  if (!Array.isArray(subdivisions) || !Array.isArray(groups)) {
    throw new HttpError('parse', 'not a list of regions');
  }
  const out = [];
  const seen = new Set();
  const add = (entry, top, group) => {
    if (out.length >= MAX_CATALOG_ENTRIES) return false;
    const code = typeof entry?.code === 'string' ? entry.code.toUpperCase() : '';
    if (!CODE.test(code) || !code.startsWith(`${country}-`) || seen.has(code)) return true;
    const names = readTexts(entry.name);
    if (Object.keys(names).length === 0) return true;
    seen.add(code);
    // The ISO 3166-2 code when the API's differs (Austria: AT-WI is AT-9).
    const iso = typeof entry.isoCode === 'string' ? entry.isoCode.toUpperCase() : '';
    const region = { code, names, top, group };
    if (CODE.test(iso) && iso !== code && iso.startsWith(`${country}-`)) region.iso = iso;
    out.push(region);
    return true;
  };
  const walk = (list, depth) => {
    if (!Array.isArray(list) || depth > 3) return;
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      if (!add(entry, depth === 0, false)) return;
      walk(entry.children, depth + 1);
    }
  };
  walk(subdivisions, 0);
  for (const g of groups) {
    if (g && typeof g === 'object') add(g, false, true);
  }
  return out;
}

export class OpenHolidaysClient {
  constructor({ fetch: fetchImpl = globalThis.fetch, now = Date.now, timers, signal } = {}) {
    this.fetch = fetchImpl;
    this.now = now;
    this.timers = timers;
    this.signal = signal;
  }

  async get(path, params, maxBytes) {
    const url = `${API_URL}/${path}?${new URLSearchParams(params).toString()}`;
    const { data } = await getJson(this.fetch, url, {
      timeoutMs: REQUEST_TIMEOUT,
      maxBytes,
      now: this.now,
      timers: this.timers,
      signal: this.signal,
    });
    return data;
  }

  /**
   * School holidays of a region `{ country, code, group }` (the whole country
   * when `code` is the country), between two dates (inclusive). The API adds
   * the nationwide holidays and those of the parent regions.
   */
  async schoolHolidays({ country, code, group }, fromDate, toDate) {
    const params = { countryIsoCode: country, validFrom: fromDate, validTo: toDate };
    if (code !== country) params[group ? 'groupCode' : 'subdivisionCode'] = code;
    return parseHolidays(await this.get('SchoolHolidays', params, MAX_HOLIDAYS_BYTES));
  }

  /** The regions of `country` (two requests). */
  async catalog(country) {
    const subdivisions = await this.get(
      'Subdivisions',
      { countryIsoCode: country },
      MAX_CATALOG_BYTES,
    );
    const groups = await this.get('Groups', { countryIsoCode: country }, MAX_CATALOG_BYTES);
    return parseCatalog(country, subdivisions, groups);
  }
}
