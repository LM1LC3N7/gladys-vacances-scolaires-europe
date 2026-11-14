// -----------------------------------------------------------------------------
// What a user typed in "Regions" -> the regions to follow. A region is given
// by its code ("DE-BY", or the ISO one when it differs: "AT-9" for "AT-WI"),
// its code without the country ("BY") or its name in
// any language of the API ("Bayern", "Bavaria"); several are separated by
// commas or semicolons. Nothing is guessed: an unknown or ambiguous entry is
// reported, never replaced by a neighbour.
// -----------------------------------------------------------------------------

import { MAX_REGIONS, MAX_REGIONS_TEXT } from './constants.js';

/** Lower case, no accent, no punctuation: "Baden-Württemberg" -> "baden wurttemberg". */
export function fold(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The entries of the text field (empty list when the field is empty). */
export function splitRegions(text) {
  if (text === undefined || text === null) return { entries: [] };
  if (typeof text !== 'string') return { error: 'invalid' };
  if (text.length > MAX_REGIONS_TEXT) return { error: 'too_long' };
  const entries = [
    ...new Set(
      text
        .split(/[,;\n]/)
        .map((e) => e.replace(/\s+/g, ' ').trim())
        .filter(Boolean),
    ),
  ];
  if (entries.length > MAX_REGIONS) return { error: 'too_many' };
  return { entries };
}

/**
 * One entry against the regions of `country` (`[{ code, names, top, group }]`)
 * -> `{ region }`, or `{ error: 'unknown' | 'ambiguous', matches }`. Exact
 * codes first, then names, the first-level regions and groups before the
 * districts and towns.
 */
export function resolveRegion(country, catalog, entry) {
  const upper = entry.normalize('NFC').toUpperCase().replace(/\s+/g, '');
  for (const code of [upper, `${country}-${upper}`]) {
    const hit = catalog.find((r) => r.code === code) ?? catalog.find((r) => r.iso === code);
    if (hit) return { region: hit };
  }
  const wanted = fold(entry);
  if (!wanted) return { error: 'unknown', matches: [] };
  const byName = (list) =>
    list.filter((r) => Object.values(r.names).some((name) => fold(name) === wanted));
  for (const level of [catalog.filter((r) => r.top || r.group), catalog]) {
    const matches = byName(level);
    if (matches.length === 1) return { region: matches[0] };
    if (matches.length > 1) return { error: 'ambiguous', matches: matches.slice(0, 5) };
  }
  return { error: 'unknown', matches: [] };
}
