// -----------------------------------------------------------------------------
// Calendar dates (YYYY-MM-DD) without timezone arithmetic: a school holiday is
// a range of calendar dates, Gladys stores a full-day event at the midnights
// of its own timezone. Everything here works on UTC dates of the strings.
// -----------------------------------------------------------------------------

import { WINDOW_MONTHS } from './constants.js';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date "YYYY-MM-DD" (no 30 February). */
export function isDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** The date `days` days after `date`. */
export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Days from `a` to `b` (b - a). */
export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * The published window for the wall-clock instant `nowMs`: the dates from the
 * 1st of the current month (UTC) to the 1st of the month WINDOW_MONTHS later.
 *
 * The window sent to Gladys is anchored at NOON UTC of those dates. A full-day
 * event is stored at the midnights of the Gladys timezone, so its start or end
 * instant lies within a day of the UTC midnight of its date; with the bounds at
 * noon UTC, for every timezone from UTC-11 to UTC+11 (Europe: UTC-1 to UTC+4):
 * - a holiday ending (inclusive) on or after `fromDate` and starting on or
 *   before `toDate` overlaps the window (what is published: never a 400);
 * - a holiday ending before `fromDate` does not overlap it (it is never pruned:
 *   the past stays in the calendar);
 * - a holiday starting after `toDate` does not overlap it either.
 */
export function windowAt(nowMs) {
  const now = new Date(nowMs);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const from = new Date(Date.UTC(y, m, 1));
  const to = new Date(Date.UTC(y, m + WINDOW_MONTHS, 1));
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = to.toISOString().slice(0, 10);
  return {
    fromDate,
    toDate,
    window: { from: `${fromDate}T12:00:00.000Z`, to: `${toDate}T12:00:00.000Z` },
  };
}

/** The UTC date of a wall-clock instant. */
export function dateAt(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}
