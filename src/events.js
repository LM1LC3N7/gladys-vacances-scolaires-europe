// -----------------------------------------------------------------------------
// From the holidays read to what Gladys stores: one calendar per region and
// user, one full-day event per holiday. Identifiers are fixed forever:
//   calendar  ext:<selector>:<user>:<region code>          (e.g. pepper:DE-BY)
//   event     ext:<selector>:<user>:<region code>:<holiday id of the API>
// The region is part of the event id: the same holiday of two regions of one
// user is two events (an id shared between calendars would MOVE the event).
// -----------------------------------------------------------------------------

import { CALENDAR_COLOR, SOURCE_URL, countryOf } from './constants.js';
import { t } from './i18n.js';
import { pick } from './openholidays.js';
import { addDays } from './time.js';

export const MAX_ID = 255;

/** The language of a Gladys user, as the API writes it ('fr' -> 'FR'). */
export function apiLanguage(user) {
  const lang = typeof user?.language === 'string' ? user.language.slice(0, 2).toUpperCase() : '';
  return /^[A-Z]{2}$/.test(lang) ? lang : 'EN';
}

/** 'fr' for a French-speaking user, else 'en' (the texts of the integration). */
export function textLanguage(user) {
  return apiLanguage(user) === 'FR' ? 'fr' : 'en';
}

function cut(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** The name shown for a region: its name in the user's language, else English. */
export function regionName(region, user) {
  if (region.whole) {
    const country = countryOf(region.country);
    return textLanguage(user) === 'fr' ? country.fr : country.en;
  }
  return pick(region.names, apiLanguage(user)) || region.code;
}

/** The calendar of one region for one user. */
export function buildCalendar(gladys, user, region) {
  const lang = textLanguage(user);
  const country = countryOf(region.country);
  const name = regionName(region, user);
  return {
    external_id: gladys.externalId(`${user.selector}:${region.code}`),
    name: cut(t('calendarName', lang, { region: name }), 100),
    description: cut(
      t('calendarDescription', lang, {
        region: region.whole ? t('wholeCountry', lang) : name,
        country: lang === 'fr' ? country.fr : country.en,
      }),
      500,
    ),
    color: CALENDAR_COLOR,
  };
}

/**
 * The events of one calendar: the holidays overlapping [fromDate, toDate]
 * (inclusive dates), full-day, end exclusive (the day after the last day).
 * Holidays whose id would exceed 255 characters are dropped (never cut: a
 * cut id could collide).
 */
export function buildEvents(gladys, user, region, holidays, fromDate, toDate) {
  const lang = textLanguage(user);
  const apiLang = apiLanguage(user);
  const events = [];
  // The same holiday given once per school type (Zürich: Volksschule,
  // Mittelschule...) with the same dates and names: one event, the first id.
  const seen = new Set();
  for (const h of holidays) {
    if (h.end < fromDate || h.start > toDate) continue;
    const twin = JSON.stringify([h.start, h.end, h.names, h.comments, h.halfDay]);
    if (seen.has(twin)) continue;
    seen.add(twin);
    const externalId = gladys.externalId(`${user.selector}:${region.code}:${h.id}`);
    if (externalId.length > MAX_ID) continue;
    const notes = [pick(h.comments, apiLang), h.halfDay ? t('halfDay', lang) : '']
      .filter(Boolean)
      .join(' ');
    events.push({
      external_id: externalId,
      name: cut(pick(h.names, apiLang), 200),
      start: h.start,
      end: addDays(h.end, 1),
      full_day: true,
      description: cut([notes, t('eventSource', lang)].filter(Boolean).join('\n'), 1000),
      url: SOURCE_URL,
    });
  }
  return events;
}

/** The status message of the problems (bounded, both languages). */
export function problemsText(problems, max = 5) {
  const shown = problems.slice(0, max);
  const more = problems.length - shown.length;
  const join = (lang) =>
    shown.map((p) => t(p.key, lang, p.values)).join(' ; ') + (more > 0 ? ` (+${more})` : '');
  return { en: join('en'), fr: join('fr') };
}
