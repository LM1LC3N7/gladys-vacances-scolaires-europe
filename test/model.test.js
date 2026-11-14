// -----------------------------------------------------------------------------
// The pure parts: answers of the API checked, regions understood, the window
// and its overlap in every timezone, the events built.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { buildCalendar, buildEvents, problemsText } from '../src/events.js';
import { parseCatalog, parseHolidays, pick, readTexts } from '../src/openholidays.js';
import { fold, resolveRegion, splitRegions } from '../src/regions.js';
import { addDays, isDate, windowAt } from '../src/time.js';
import { HttpError, retryAfterMs } from '../src/http.js';
import { fixture } from './helpers/app.js';

const holiday = (extra = {}) => ({
  id: 'a1',
  startDate: '2026-12-24',
  endDate: '2027-01-08',
  type: 'School',
  name: [{ language: 'DE', text: 'Weihnachtsferien' }],
  ...extra,
});

test('holidays: only school holidays with real dates, names and ids, sorted, bounded', () => {
  const out = parseHolidays([
    holiday({ id: 'b2', startDate: '2027-02-08', endDate: '2027-02-12' }),
    holiday(),
    holiday({ id: 'a1' }), // duplicate id
    holiday({ id: 'c3', type: 'BackToSchool' }),
    holiday({ id: 'd4', startDate: '2027-02-30' }),
    holiday({ id: 'e5', endDate: '2026-12-01' }), // ends before it starts
    holiday({ id: 'f6', startDate: '2026-01-01', endDate: '2026-12-31' }), // a year
    holiday({ id: 'g 7' }),
    holiday({ id: 'h8', name: [] }),
    holiday({
      id: 'i9',
      name: [{ language: 'EN', text: '  Half\nterm\u0000 \u0007day\u2028off ' }],
      temporalScope: 'HalfDay',
    }),
    null,
    'x',
  ]);
  assert.deepEqual(
    out.map((h) => h.id),
    ['a1', 'i9', 'b2'],
  );
  assert.deepEqual(out[1].names, { EN: 'Half term day off' });
  assert.equal(out[1].halfDay, true);
  assert.throws(() => parseHolidays({}), HttpError);
  assert.throws(() => parseHolidays(new Array(501).fill(holiday())), /too many/);
  // The recorded answer of the API passes whole.
  const real = fixture('holidays-DE-BY');
  assert.equal(parseHolidays(real).length, real.filter((h) => h.type === 'School').length);
});

test('texts: bounded, one line, language codes upper case, first wins; pick falls back to the first', () => {
  const texts = readTexts([
    { language: 'de', text: 'Bayern' },
    { language: 'EN', text: 'Bavaria' },
    { language: 'EN', text: 'other' },
    { language: 'english', text: 'x' },
    { language: 'FR', text: 'y'.repeat(500) },
  ]);
  assert.deepEqual(Object.keys(texts), ['DE', 'EN', 'FR']);
  assert.equal(texts.EN, 'Bavaria');
  assert.equal(texts.FR.length, 300);
  assert.equal(pick(texts, 'EN'), 'Bavaria');
  assert.equal(pick({ DE: 'Bayern', EN: 'Bavaria' }, 'IT'), 'Bayern');
  assert.equal(pick({}, 'EN'), '');
  assert.deepEqual(readTexts('x'), {});
});

test('catalog: subdivisions with children, groups, foreign or malformed codes dropped', () => {
  const catalog = parseCatalog(
    'CH',
    [
      {
        code: 'CH-ZH',
        name: [{ language: 'DE', text: 'Zürich' }],
        children: [{ code: 'CH-ZH-WI', name: [{ language: 'DE', text: 'Winterthur' }] }],
      },
      { code: 'DE-BY', name: [{ language: 'DE', text: 'Bayern' }] },
      { code: 'CH-../x', name: [{ language: 'DE', text: 'x' }] },
      { code: 'CH-BE', name: [] },
    ],
    [{ code: 'CH-NW-REG', name: [{ language: 'DE', text: 'Nordwestschweiz' }] }],
  );
  assert.deepEqual(
    catalog.map((r) => [r.code, r.top, r.group]),
    [
      ['CH-ZH', true, false],
      ['CH-ZH-WI', false, false],
      ['CH-NW-REG', false, true],
    ],
  );
  assert.throws(() => parseCatalog('CH', {}, []), HttpError);
  const de = parseCatalog('DE', fixture('subdivisions-DE'), fixture('groups-DE'));
  assert.equal(de.filter((r) => r.top).length, 16);
});

test('regions: code, short code, name in any language, accents and case ignored; never guessed', () => {
  const de = parseCatalog('DE', fixture('subdivisions-DE'), fixture('groups-DE'));
  const code = (entry) => resolveRegion('DE', de, entry).region?.code;
  assert.equal(code('DE-BY'), 'DE-BY');
  assert.equal(code('by'), 'DE-BY');
  assert.equal(code('Bayern'), 'DE-BY');
  assert.equal(code('bavaria'), 'DE-BY');
  assert.equal(code('baden wurttemberg'), 'DE-BW');
  assert.equal(code('Baden-Württemberg'), 'DE-BW');
  assert.equal(code('DE-MV-ABS'), 'DE-MV-ABS');
  const at = parseCatalog(
    'AT',
    [
      { code: 'AT-WI', isoCode: 'AT-9', name: [{ language: 'DE', text: 'Wien' }] },
      { code: 'AT-TI', isoCode: 'DE-7', name: [{ language: 'DE', text: 'Tirol' }] },
    ],
    [],
  );
  assert.equal(resolveRegion('AT', at, 'AT-9').region.code, 'AT-WI', 'the ISO code');
  assert.equal(resolveRegion('AT', at, '9').region.code, 'AT-WI');
  assert.equal(at[1].iso, undefined, 'a foreign ISO code is not kept');
  assert.deepEqual(resolveRegion('DE', de, 'Atlantis'), { error: 'unknown', matches: [] });
  assert.deepEqual(resolveRegion('DE', de, '---'), { error: 'unknown', matches: [] });
  assert.equal(resolveRegion('DE', de, 'Bay').error, 'unknown', 'no prefix match');
  const twins = [
    { code: 'XX-A', names: { EN: 'North' }, top: true, group: false },
    { code: 'XX-B', names: { EN: 'north' }, top: false, group: true },
  ];
  const amb = resolveRegion('XX', twins, 'North');
  assert.equal(amb.error, 'ambiguous');
  assert.deepEqual(
    amb.matches.map((m) => m.code),
    ['XX-A', 'XX-B'],
  );
  assert.equal(fold(' Zürich-Stadt '), 'zurich stadt');
});

test('the regions field: up to 3, 200 characters, commas or semicolons, duplicates merged', () => {
  assert.deepEqual(splitRegions(undefined), { entries: [] });
  assert.deepEqual(splitRegions(''), { entries: [] });
  assert.deepEqual(splitRegions(' BY ;Berlin,, BY '), { entries: ['BY', 'Berlin'] });
  assert.deepEqual(splitRegions('a,b,c,d'), { error: 'too_many' });
  assert.deepEqual(splitRegions('x'.repeat(201)), { error: 'too_long' });
  assert.deepEqual(splitRegions(42), { error: 'invalid' });
});

test('dates: real dates only; days added across months and leap years', () => {
  assert.ok(isDate('2028-02-29'));
  assert.ok(!isDate('2027-02-29'));
  assert.ok(!isDate('2027-1-01'));
  assert.ok(!isDate(20270101));
  assert.equal(addDays('2027-12-31', 1), '2028-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('the window: 1st of the month to 13 months later, noon UTC; December rolls the year', () => {
  assert.deepEqual(windowAt(Date.parse('2026-11-14T10:00:00Z')), {
    fromDate: '2026-11-01',
    toDate: '2027-12-01',
    window: { from: '2026-11-01T12:00:00.000Z', to: '2027-12-01T12:00:00.000Z' },
  });
  assert.equal(windowAt(Date.parse('2026-12-31T23:59:59Z')).toDate, '2028-01-01');
  assert.equal(windowAt(Date.parse('2027-01-01T00:00:00Z')).fromDate, '2027-01-01');
});

// The core stores a full-day date at the midnight of its timezone: for a fixed
// offset, the UTC midnight of the date minus the offset.
const stored = (date, offsetH) => Date.parse(`${date}T00:00:00Z`) - offsetH * 3_600_000;
const overlaps = (start, end, w) =>
  start < Date.parse(w.to) && (end > Date.parse(w.from) || start >= Date.parse(w.from));

test('every timezone from UTC-11 to UTC+11: what is published overlaps the window, the past is never pruned', () => {
  const { fromDate, toDate, window } = windowAt(Date.parse('2026-11-14T10:00:00Z'));
  const dates = [];
  for (let d = -3; d <= 3; d += 1) dates.push(addDays(fromDate, d), addDays(toDate, d));
  for (let offset = -11; offset <= 11; offset += 0.5) {
    for (const start of dates) {
      for (const len of [0, 1, 2, 10]) {
        const end = addDays(start, len); // inclusive last day
        const s = stored(start, offset);
        const e = stored(addDays(end, 1), offset);
        const published = end >= fromDate && start <= toDate;
        const inWindow = overlaps(s, e, window);
        assert.equal(inWindow, published, `${start}..${end} at UTC${offset}`);
      }
    }
  }
});

test('events: full day, end exclusive, within the window, names in the user language else local', () => {
  const gladys = createFakeGladys({ selector: 'vse' });
  const holidays = parseHolidays([
    holiday({
      name: [
        { language: 'DE', text: 'Weihnachtsferien' },
        { language: 'FR', text: 'Vacances de Noël' },
      ],
      comment: [{ language: 'DE', text: 'Nur Grundschulen' }],
      temporalScope: 'HalfDay',
    }),
    holiday({ id: 'old', startDate: '2026-10-01', endDate: '2026-10-31' }),
    holiday({ id: 'edge', startDate: '2026-10-26', endDate: '2026-11-01' }),
    holiday({ id: 'late', startDate: '2027-12-02', endDate: '2027-12-03' }),
  ]);
  const region = { country: 'DE', code: 'DE-BY', names: { DE: 'Bayern', EN: 'Bavaria' } };
  const fr = { selector: 'pepper', language: 'fr' };
  const events = buildEvents(gladys, fr, region, holidays, '2026-11-01', '2027-12-01');
  assert.deepEqual(
    events.map((e) => e.external_id.split(':').at(-1)),
    ['edge', 'a1'],
  );
  assert.equal(events[0].start, '2026-10-26');
  assert.equal(events[0].end, '2026-11-02');
  assert.equal(events[1].name, 'Vacances de Noël');
  assert.equal(
    events[1].description,
    'Nur Grundschulen Demi-journée.\nSource : API OpenHolidays (openholidaysapi.org), ODbL-1.0.',
  );
  // Twins (same dates, names, notes; another school type): one event, the first id.
  const twins = parseHolidays([
    holiday({ id: 'z2' }),
    holiday({ id: 'z1' }),
    holiday({ id: 'z3', endDate: '2027-01-07' }),
  ]);
  assert.deepEqual(
    buildEvents(gladys, fr, region, twins, '2026-11-01', '2027-12-01').map((e) =>
      e.external_id.split(':').at(-1),
    ),
    ['z1', 'z3'],
  );
  const it = buildEvents(
    gladys,
    { selector: 'gio', language: 'it' },
    region,
    holidays,
    '2026-11-01',
    '2027-12-01',
  );
  assert.equal(it[1].name, 'Weihnachtsferien');
  // An id beyond 255 characters is dropped, never cut.
  const long = buildEvents(
    gladys,
    { selector: 'p'.repeat(240), language: 'en' },
    region,
    holidays,
    '2026-11-01',
    '2027-12-01',
  );
  assert.deepEqual(long, []);
  const calendar = buildCalendar(gladys, { selector: 'pepper', language: 'en' }, region);
  assert.equal(calendar.name, 'School holidays – Bavaria');
  assert.equal(calendar.external_id, 'ext:vse:pepper:DE-BY');
  const whole = buildCalendar(gladys, fr, { country: 'LU', code: 'LU', whole: true });
  assert.equal(whole.name, 'Vacances scolaires – Luxembourg');
  assert.match(whole.description, /tout le pays/);
});

test('the status lists 5 problems at most, then a count', () => {
  const problems = Array.from({ length: 7 }, (_, i) => ({
    key: 'problemCountry',
    values: { user: `u${i}` },
  }));
  const text = problemsText(problems);
  assert.match(text.en, /u4: no country/);
  assert.doesNotMatch(text.en, /u5/);
  assert.match(text.en, /\(\+2\)$/);
});

test('Retry-After: seconds or an HTTP date, anything else ignored', () => {
  const now = Date.parse('2026-11-14T10:00:00Z');
  assert.equal(retryAfterMs('120', now), 120_000);
  assert.equal(retryAfterMs('Sat, 14 Nov 2026 10:05:00 GMT', now), 300_000);
  assert.equal(retryAfterMs('soon', now), undefined);
  assert.equal(retryAfterMs(undefined, now), undefined);
});

test('twins: merged only when dates, names, notes and half day are all equal', () => {
  const gladys = createFakeGladys({ selector: 'vse' });
  const region = { country: 'CH', code: 'CH-ZH', names: { DE: 'Zürich' } };
  const user = { selector: 'u', language: 'de' };
  const base = {
    id: 'a',
    startDate: '2027-04-26',
    endDate: '2027-05-08',
    type: 'School',
    name: [{ language: 'DE', text: 'Frühlingsferien' }],
  };
  const count = (other) =>
    buildEvents(
      gladys,
      user,
      region,
      parseHolidays([base, { ...base, id: 'b', ...other }]),
      '2026-11-01',
      '2027-12-01',
    ).length;
  assert.equal(count({}), 1, 'identical: one');
  assert.equal(count({ startDate: '2027-04-27' }), 2, 'another start');
  assert.equal(count({ endDate: '2027-05-07' }), 2, 'another end');
  assert.equal(count({ name: [{ language: 'DE', text: 'Frühling' }] }), 2, 'another name');
  assert.equal(count({ comment: [{ language: 'DE', text: 'Nur Gymnasien' }] }), 2, 'a note');
  assert.equal(count({ temporalScope: 'HalfDay' }), 2, 'a half day');
});

test('school types named in the description, merged twins name them all', () => {
  const gladys = createFakeGladys({ selector: 'vse' });
  const catalog = parseCatalog(
    'CH',
    [],
    [
      {
        code: 'CH-ZH-VS',
        name: [
          { language: 'DE', text: 'Volksschulen' },
          { language: 'FR', text: 'Écoles primaires' },
        ],
      },
      { code: 'CH-ZH-MS', name: [{ language: 'DE', text: 'Mittelschulen' }] },
    ],
  );
  const h = (id, groups) => ({
    id,
    startDate: '2027-03-26',
    endDate: '2027-03-29',
    type: 'School',
    name: [{ language: 'DE', text: 'Ostern' }],
    groups: groups.map((code) => ({ code })),
  });
  const holidays = parseHolidays([h('b', ['CH-ZH-VS']), h('a', ['CH-ZH-MS', 'CH-ZH-BS'])]);
  const region = { country: 'CH', code: 'CH-ZH', names: { DE: 'Zürich' } };
  const [event] = buildEvents(
    gladys,
    { selector: 'u', language: 'fr' },
    region,
    holidays,
    '2026-11-01',
    '2027-12-01',
    catalog,
  );
  assert.equal(event.external_id, 'ext:vse:u:CH-ZH:a');
  assert.equal(
    event.description,
    'Pour : Mittelschulen, CH-ZH-BS, Écoles primaires.\nSource : API OpenHolidays (openholidaysapi.org), ODbL-1.0.',
  );
});

test('the window edges: a holiday starting on the last date is in, the day after is out', () => {
  const gladys = createFakeGladys({ selector: 'vse' });
  const region = { country: 'DE', code: 'DE-BY', names: { DE: 'Bayern' } };
  const holidays = parseHolidays([
    holiday({ id: 'on', startDate: '2027-12-01', endDate: '2027-12-03' }),
    holiday({ id: 'after', startDate: '2027-12-02', endDate: '2027-12-03' }),
    holiday({ id: 'ends', startDate: '2026-10-20', endDate: '2026-11-01' }),
    holiday({ id: 'before', startDate: '2026-10-20', endDate: '2026-10-31' }),
  ]);
  const ids = buildEvents(
    gladys,
    { selector: 'u' },
    region,
    holidays,
    '2026-11-01',
    '2027-12-01',
  ).map((e) => e.external_id.split(':').at(-1));
  assert.deepEqual(ids.sort(), ['ends', 'on']);
});

test('long summers kept (Bulgaria: 122 days); a year is not a holiday', () => {
  const out = parseHolidays([
    holiday({ id: 'bg', startDate: '2026-05-16', endDate: '2026-09-14' }),
    holiday({ id: 'year', startDate: '2026-01-01', endDate: '2026-12-31' }),
  ]);
  assert.deepEqual(
    out.map((h) => h.id),
    ['bg'],
  );
});

test('non-ASCII region codes: Austria and Swiss districts, by code, ISO code and name', () => {
  const at = parseCatalog('AT', fixture('subdivisions-AT'), []);
  assert.deepEqual(at.map((r) => r.code).sort(), [
    'AT-BL',
    'AT-KÄ',
    'AT-NÖ',
    'AT-OÖ',
    'AT-SB',
    'AT-SM',
    'AT-TI',
    'AT-VA',
    'AT-WI',
  ]);
  const code = (entry) => resolveRegion('AT', at, entry).region?.code;
  assert.equal(code('AT-KÄ'), 'AT-KÄ');
  assert.equal(code('at-kä'), 'AT-KÄ', 'decomposed Ä');
  assert.equal(code('AT-3'), 'AT-NÖ');
  assert.equal(code('Oberösterreich'), 'AT-OÖ');
  assert.equal(code('oberosterreich'), 'AT-OÖ');
  const ch = parseCatalog('CH', fixture('subdivisions-CH-BE'), []);
  assert.ok(ch.some((r) => r.code === 'CH-BE-SL-RÜ'));
  assert.equal(resolveRegion('CH', ch, 'ch-be-sl-rü').region.code, 'CH-BE-SL-RÜ');
  // Still no punctuation, no lower case, no foreign prefix.
  const odd = parseCatalog(
    'AT',
    [
      { code: 'AT-k', name: [{ language: 'DE', text: 'x' }] },
      { code: 'AT-K.', name: [{ language: 'DE', text: 'x' }] },
      { code: 'DE-KÄ', name: [{ language: 'DE', text: 'x' }] },
    ],
    [],
  );
  assert.deepEqual(
    odd.map((r) => r.code),
    ['AT-K'],
  );
});

test('the ODbL line is never cut: the notes are', () => {
  const gladys = createFakeGladys({ selector: 'vse' });
  const groups = Array.from({ length: 20 }, (_, i) => ({
    code: `CH-ZH-T${String(i).padStart(2, '0')}`,
    name: [{ language: 'DE', text: `Schultyp ${'x'.repeat(50)} ${i}` }],
  }));
  const catalog = parseCatalog('CH', [], groups);
  const holidays = parseHolidays([
    {
      id: 'a',
      startDate: '2027-03-26',
      endDate: '2027-03-29',
      type: 'School',
      name: [{ language: 'DE', text: 'Ostern' }],
      comment: [{ language: 'DE', text: 'y'.repeat(300) }],
      groups: groups.map((g) => ({ code: g.code })),
    },
  ]);
  assert.equal(holidays[0].groups.length, 20, 'the API groups read, 20 at most');
  const region = { country: 'CH', code: 'CH-ZH', names: { DE: 'Zürich' } };
  const [event] = buildEvents(
    gladys,
    { selector: 'u', language: 'en' },
    region,
    holidays,
    '2026-11-01',
    '2027-12-01',
    catalog,
  );
  assert.ok(event.description.length <= 1000);
  assert.ok(
    event.description.endsWith('\nSource: OpenHolidays API (openholidaysapi.org), ODbL-1.0.'),
  );
  assert.match(event.description, /…\n/);
});

test('the groups of a holiday: 20 at most, codes checked', () => {
  const [h] = parseHolidays([
    {
      id: 'a',
      startDate: '2027-03-26',
      endDate: '2027-03-29',
      type: 'School',
      name: [{ language: 'DE', text: 'Ostern' }],
      groups: [
        { code: 'ch-zh-vs' },
        { code: 'CH-ZH-VS' },
        { code: '../x' },
        ...Array.from({ length: 25 }, (_, i) => ({ code: `CH-G${i}` })),
      ],
    },
  ]);
  assert.equal(h.groups[0], 'CH-ZH-VS');
  assert.ok(!h.groups.includes('../x'));
  assert.equal(h.groups.length, 18, '20 entries read, 2 dropped');
});

test('no "For:" when the calendar is the school type itself', () => {
  const gladys = createFakeGladys({ selector: 'vse' });
  const holidays = parseHolidays([
    {
      id: 'a',
      startDate: '2026-12-21',
      endDate: '2027-01-01',
      type: 'School',
      name: [{ language: 'FR', text: 'Vacances d’hiver' }],
      groups: [{ code: 'BE-FR' }],
    },
  ]);
  const region = {
    country: 'BE',
    code: 'BE-FR',
    names: { FR: 'Communauté française' },
    group: true,
  };
  const [event] = buildEvents(
    gladys,
    { selector: 'u', language: 'fr' },
    region,
    holidays,
    '2026-11-01',
    '2027-12-01',
  );
  assert.equal(event.description, 'Source : API OpenHolidays (openholidaysapi.org), ODbL-1.0.');
});

test('500 holidays are taken, 501 refused', () => {
  const list = (n) =>
    Array.from({ length: n }, (_, i) =>
      holiday({ id: `h${i}`, startDate: '2027-01-01', endDate: '2027-01-02' }),
    );
  assert.equal(parseHolidays(list(500)).length, 500);
  assert.throws(() => parseHolidays(list(501)), /too many/);
});
