// -----------------------------------------------------------------------------
// The app end to end on the fake Gladys: calendars and events published, the
// API read once a day at most (restarts, clicks, passes), pauses, the write
// budget of Gladys, the users' toggles and changes, /data troubles.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/store.js';
import { USER_AGENT } from '../src/constants.js';
import {
  API,
  CAL,
  DAY,
  HOUR,
  MINUTE,
  SECOND,
  SELECTOR,
  WINDOW,
  account,
  createFakeClock,
  createNet,
  json,
  setup,
  settle,
  writes,
} from './helpers/app.js';

const holidayCalls = (net) => net.count('SchoolHolidays');

test('a user in Bavaria: one calendar, its holidays as full-day events, the window of 13 months', async (t) => {
  const { fake, net, app } = await setup();
  t.after(() => app.stop());
  assert.equal(net.count('Subdivisions?countryIsoCode=DE'), 1);
  assert.equal(net.count('Groups?countryIsoCode=DE'), 1);
  assert.equal(holidayCalls(net), 1);
  const call = net.calls.find((c) => c.url.includes('SchoolHolidays'));
  assert.equal(
    call.url,
    `${API}SchoolHolidays?countryIsoCode=DE&validFrom=2026-11-01&validTo=2027-12-01&subdivisionCode=DE-BY`,
  );
  for (const c of net.calls) {
    assert.equal(c.headers['User-Agent'], USER_AGENT);
    assert.equal(c.headers.Accept, 'application/json');
  }
  assert.match(
    USER_AGENT,
    /^gladys-vacances-scolaires-europe\/0\.1\.0 \(\+https:\/\/github\.com\/LM1LC3N7\//,
  );
  assert.deepEqual(
    fake.calendars.map((c) => [c.external_id, c.name, c.color, c.user]),
    [[CAL('pepper', 'DE-BY'), 'Vacances scolaires – Bayern', '#2a9d8f', 'pepper']],
  );
  assert.match(fake.calendars[0].description, /OpenHolidays.*ODbL-1\.0/);
  const [batch] = fake.publishedCalendarEvents;
  assert.deepEqual(batch.window, WINDOW);
  const christmas = batch.events.find((e) => e.start === '2026-12-24');
  assert.deepEqual(christmas, {
    external_id: `${CAL('pepper', 'DE-BY')}:c38a3f7c-04e7-4acf-ae55-1063a077bf9b`,
    name: 'Weihnachtsferien',
    start: '2026-12-24',
    end: '2027-01-09', // the 8th is the last day: exclusive end the day after
    full_day: true,
    description: 'Source : API OpenHolidays (openholidaysapi.org), ODbL-1.0.',
    url: 'https://www.openholidaysapi.org',
  });
  // Every event a full day, within the window, ids of this user and region.
  for (const e of batch.events) {
    assert.equal(e.full_day, true);
    assert.ok(e.end > '2026-11-01' && e.start <= '2027-12-01', e.start);
    assert.ok(e.external_id.startsWith(`ext:${SELECTOR}:pepper:DE-BY:`));
  }
  assert.ok(batch.events.length >= 8);
  assert.equal(fake.connectionStatus.connected, true);
  assert.match(fake.connectionStatus.message.fr, /1 utilisateur\(s\), 1 calendrier\(s\) à jour/);
});

test('the hourly check reads nothing and sends nothing; the API again after a day only', async (t) => {
  const { fake, net, app, clock } = await setup();
  t.after(() => app.stop());
  const calls = net.calls.length;
  const sent = writes(fake).length;
  await clock.advance(5 * HOUR);
  assert.equal(net.calls.length, calls, 'no request within the day');
  assert.equal(writes(fake).length, sent, 'nothing resent');
  await clock.advance(20 * HOUR); // 25 h after the first read
  assert.equal(holidayCalls(net), 2, 'the holidays again after a day');
  assert.equal(net.count('Subdivisions'), 1, 'the regions once a week');
  assert.equal(writes(fake).length, sent, 'same holidays: nothing resent');
  await clock.advance(7 * DAY);
  assert.equal(net.count('Subdivisions'), 2);
  assert.ok(holidayCalls(net) <= 2 + 8, 'never more than once a day');
});

test('restart: /data gives the holidays, nothing read again within the day, all resent', async (t) => {
  const store = createMemoryStore();
  const first = await setup({ store });
  await first.app.stop();
  assert.ok(store.saves > 0);
  const net = createNet();
  const clock = createFakeClock(Date.parse('2026-11-14T18:00:00Z'));
  const second = await setup({ store, net, clock });
  t.after(() => second.app.stop());
  assert.equal(net.calls.length, 0, 'nothing read: /data is fresh');
  assert.equal(second.fake.publishedCalendarEvents.length, 1, 'resent after the restart');
  assert.ok(second.fake.publishedCalendarEvents[0].events.length >= 8);
});

test('restart right after an attempt that left no data: no new request within a minute', async (t) => {
  const store = createMemoryStore({
    attempts: { 'catalogs:DE': Date.parse('2026-11-14T09:59:40Z') },
  });
  const { net, app, clock, fake } = await setup({ store });
  t.after(() => app.stop());
  assert.equal(net.calls.length, 0);
  assert.match(
    fake.connectionStatus.message.fr,
    /régions de Allemagne n’ont pas encore pu être lues/,
  );
  await clock.advance(HOUR);
  assert.equal(net.count('Subdivisions'), 1, 'read at the next check');
  assert.equal(fake.calendars.length, 1);
});

test('the wall clock set back two days: still read once a day (monotonic guard)', async (t) => {
  const { net, app, clock } = await setup();
  t.after(() => app.stop());
  clock.jumpWall(-2 * DAY);
  await clock.advance(5 * HOUR);
  assert.equal(holidayCalls(net), 1);
  assert.equal(net.count('Subdivisions'), 1);
});

test('the wall clock set back three days: the holidays still read again after a day', async (t) => {
  const { net, app, clock } = await setup();
  t.after(() => app.stop());
  clock.jumpWall(-3 * DAY);
  await clock.advance(23 * HOUR);
  assert.equal(holidayCalls(net), 1);
  await clock.advance(2 * HOUR);
  assert.equal(holidayCalls(net), 2, 'a date of the data in the future is stale');
});

test('during a pause nothing is attempted, not even written to /data', async (t) => {
  const net = createNet();
  net.override = () => json({}, 429, { 'retry-after': String(5 * 3600) });
  const store = createMemoryStore();
  const { app, clock } = await setup({ net, store });
  t.after(() => app.stop());
  const saves = store.saves;
  const attempts = structuredClone(store.data.attempts);
  await clock.advance(4 * HOUR);
  assert.equal(net.calls.length, 1);
  assert.equal(store.saves, saves);
  assert.deepEqual(store.data.attempts, attempts);
});

test('/data read back: malformed entries dropped, never published', async (t) => {
  const fetchedAt = Date.parse('2026-11-14T09:00:00Z');
  const store = createMemoryStore({
    catalogs: {
      DE: {
        fetchedAt,
        items: [
          { code: 'DE-BY', names: { DE: 'Bayern' }, top: true, group: false },
          { code: '../x', names: { DE: 'x' } },
          { code: 'DE-BE', names: 'Berlin' },
        ],
      },
    },
    holidays: {
      'DE|DE-BY': {
        fetchedAt,
        fromDate: '2026-11-01',
        toDate: '2027-12-01',
        items: [
          { id: 'ok', start: '2026-12-24', end: '2027-01-08', names: { DE: 'Weihnachten' } },
          { id: 'bad date', start: '2026-12-24', end: '2027-01-08', names: { DE: 'x' } },
          { id: 'b', start: '2027-02-30', end: '2027-03-01', names: { DE: 'x' } },
          { id: 'c', start: '2027-03-01', end: '2027-03-02', names: { DE: 42 } },
          null,
        ],
      },
    },
  });
  const { net, app, fake } = await setup({ store });
  t.after(() => app.stop());
  assert.equal(net.calls.length, 0, 'fresh /data: nothing read');
  assert.deepEqual(
    fake.calendarEvents.map((e) => e.name),
    ['Weihnachten'],
  );
});

test('a date of /data in the future is not trusted: read again', async (t) => {
  const store = createMemoryStore({
    catalogs: { DE: { fetchedAt: Date.parse('2027-01-01T00:00:00Z'), items: [] } },
    attempts: { 'catalogs:DE': Date.parse('2027-01-01T00:00:00Z') },
  });
  const { net, app } = await setup({ store });
  t.after(() => app.stop());
  assert.equal(net.count('Subdivisions'), 1);
});

test('API down: every request paused 60 s, doubled, persisted; Retry-After honoured', async (t) => {
  const net = createNet();
  net.fail = 503;
  const store = createMemoryStore();
  const { app, clock, fake } = await setup({ net, store });
  t.after(() => app.stop());
  assert.equal(net.calls.length, 1, 'the first failure pauses everything');
  assert.equal(fake.connectionStatus.connected, false);
  assert.match(fake.connectionStatus.message.en, /OpenHolidays unreachable \(HTTP 503\)/);
  assert.ok(store.data.pause.untilWall > Date.parse('2026-11-14T10:00:30Z'));
  await clock.advance(59 * SECOND);
  assert.equal(net.calls.length, 1, 'nothing during the pause');
  await clock.advance(3 * SECOND);
  assert.equal(net.calls.length, 2, 'once the pause is over');
  await clock.advance(110 * SECOND);
  assert.equal(net.calls.length, 2, 'second pause: 120 s');
  await clock.advance(15 * SECOND);
  assert.equal(net.calls.length, 3);
  net.fail = (url) => (url.includes('Subdivisions') ? 429 : 0);
  net.override = (url) =>
    url.includes('Subdivisions') ? json({}, 429, { 'retry-after': '1800' }) : undefined;
  await clock.advance(5 * MINUTE);
  const at = net.calls.length;
  // The 429 came at ~7 min: nothing until ~37 min (the doubled pause was 8 min).
  await clock.advance(25 * MINUTE);
  assert.equal(net.calls.length, at, 'Retry-After of 30 min honoured');
  net.override = undefined;
  net.fail = undefined;
  await clock.advance(6 * MINUTE);
  assert.ok(net.calls.length > at);
  assert.equal(fake.calendars.length, 1);
  assert.equal(fake.connectionStatus.connected, true);
});

test('a pause in /data is kept after a restart; a pause beyond 6 h is not ours', async (t) => {
  const store = createMemoryStore({
    pause: { untilWall: Date.parse('2026-11-14T10:30:00Z'), level: 3, reason: 'HTTP 503' },
  });
  const a = await setup({ store });
  assert.equal(a.net.calls.length, 0, 'paused until 10:30');
  await a.clock.advance(31 * MINUTE);
  assert.equal(a.net.count('Subdivisions'), 1);
  await a.app.stop();

  const far = createMemoryStore({
    pause: { untilWall: Date.parse('2026-11-15T10:00:00Z'), level: 3, reason: 'HTTP 503' },
  });
  const b = await setup({ store: far });
  t.after(() => b.app.stop());
  assert.equal(b.net.count('Subdivisions'), 1, 'a pause of 24 h is ignored');
});

test('an answer too large is cut, never read whole, and pauses', async (t) => {
  const net = createNet();
  let pulled = 0;
  net.override = (url) => {
    if (!url.includes('SchoolHolidays')) return undefined;
    // 3 MB of spaces: finite (a test fails, never hangs), cut at 1 MB.
    const chunk = new Uint8Array(64 * 1024).fill(32);
    const body = new ReadableStream({
      pull(controller) {
        if (pulled >= 3 * 1024 * 1024) {
          controller.close();
          return;
        }
        pulled += chunk.length;
        controller.enqueue(chunk);
      },
    });
    return new Response(body, { status: 200 });
  };
  const { app, fake } = await setup({ net });
  t.after(() => app.stop());
  assert.ok(pulled <= 1.2 * 1024 * 1024, `read ${pulled} bytes`);
  assert.equal(fake.publishedCalendarEvents.length, 0);
  assert.match(fake.connectionStatus.message.en, /too_large/);
});

test('an API that never answers is cut by the deadline (20 s)', async (t) => {
  const net = createNet();
  net.hang = true;
  const { app, clock, fake } = await setup({ net });
  t.after(() => app.stop());
  await clock.advance(21 * SECOND);
  assert.match(fake.connectionStatus.message.en, /timeout/);
});

test('the user changes region: the old calendar deleted, the new one filled', async (t) => {
  const { app, fake, clock } = await setup();
  t.after(() => app.stop());
  fake.calendarAccounts[0].config = { country: 'DE', regions: 'BE' };
  await fake.calendarAccountUpdated('pepper');
  await clock.advance(0);
  assert.deepEqual(fake.deletedCalendars, [CAL('pepper', 'DE-BY')]);
  assert.deepEqual(
    fake.calendars.map((c) => c.name),
    ['Vacances scolaires – Berlin'],
  );
  assert.ok(fake.calendarEvents.every((e) => e.calendar_external_id === CAL('pepper', 'DE-BE')));
});

test('an unknown or ambiguous region changes nothing and is reported', async (t) => {
  const { app, fake, clock } = await setup();
  t.after(() => app.stop());
  const events = fake.calendarEvents.length;
  fake.calendarAccounts[0].config = { country: 'DE', regions: 'Berlin, Atlantis' };
  await fake.calendarAccountUpdated('pepper');
  await clock.advance(0);
  assert.deepEqual(fake.deletedCalendars, []);
  assert.equal(fake.calendarEvents.length, events);
  assert.match(fake.connectionStatus.message.fr, /région « Atlantis » inconnue en Allemagne/);
  assert.match(fake.connectionStatus.message.en, /region "Atlantis" unknown in Germany/);
  fake.calendarAccounts[0].config = { country: 'DE', regions: 'a, b, c, d' };
  await fake.calendarAccountUpdated('pepper');
  await clock.advance(0);
  assert.match(fake.connectionStatus.message.en, /3 regions at most/);
  fake.calendarAccounts[0].config = { country: 'FR', regions: '' };
  await fake.calendarAccountUpdated('pepper');
  await clock.advance(0);
  assert.match(fake.connectionStatus.message.en, /no country chosen/);
  assert.deepEqual(fake.deletedCalendars, []);
});

test('a country with regions needs one; Luxembourg: the whole country', async (t) => {
  const { app, fake } = await setup({
    accounts: [
      account('anna', { country: 'DE' }, 'de'),
      account('luc', { country: 'LU', regions: '' }, 'fr'),
    ],
  });
  t.after(() => app.stop());
  assert.match(fake.connectionStatus.message.en, /anna: Germany has school holidays by region/);
  assert.deepEqual(
    fake.calendars.map((c) => [c.external_id, c.name]),
    [[CAL('luc', 'LU'), 'Vacances scolaires – Luxembourg']],
  );
  const noel = fake.calendarEvents.find((e) => e.start === '2026-12-19');
  assert.equal(noel.name, 'Vacances de Noël');
});

test('a Belgian community (a group of the API) and three regions for one user', async (t) => {
  const { app, fake, net } = await setup({
    accounts: [
      account('bea', { country: 'BE', regions: 'Communauté française' }, 'fr'),
      account('max', { country: 'DE', regions: 'BY; Berlin ,DE-BY' }, 'en'),
    ],
  });
  t.after(() => app.stop());
  assert.ok(net.calls.some((c) => c.url.includes('groupCode=BE-FR')));
  const names = fake.calendars.map((c) => c.name).sort();
  assert.deepEqual(names, [
    'School holidays – Bavaria',
    'School holidays – Berlin',
    'Vacances scolaires – Communauté française',
  ]);
  // The same holiday in two regions of one user: two events, never moved.
  const ids = new Set(fake.calendarEvents.map((e) => e.external_id));
  assert.equal(ids.size, fake.calendarEvents.length);
  // English names for an English-speaking user, when the API has them.
  assert.ok(fake.calendarEvents.some((e) => e.name === 'Christmas Holidays'));
});

test('a calendar the user stopped syncing gets no event; sync back on: everything resent', async (t) => {
  const { app, fake, clock } = await setup();
  t.after(() => app.stop());
  const pushes = fake.publishedCalendarEvents.length;
  fake.calendars[0].sync = false;
  await fake.calendarAccountUpdated('pepper');
  await clock.advance(0);
  assert.equal(fake.publishedCalendarEvents.length, pushes);
  assert.ok(!fake.requests.some((r) => r.status === 403));
  fake.calendars[0].sync = true;
  await fake.calendarAccountUpdated('pepper');
  await clock.advance(0);
  assert.equal(fake.publishedCalendarEvents.length, pushes + 1);
});

test('a user who disabled the integration meanwhile (404): the pass goes on for the others', async (t) => {
  const { app, fake, clock } = await setup({
    connect: false,
    accounts: [
      account('pepper', { country: 'DE', regions: 'Bayern' }),
      account('zoe', { country: 'LU' }),
    ],
  });
  t.after(() => app.stop());
  const publish = app.gladys.publishCalendars.bind(app.gladys);
  app.gladys.publishCalendars = async (user, calendars) => {
    if (user === 'pepper') throw Object.assign(new Error('gone'), { status: 404 });
    return publish(user, calendars);
  };
  await app.gladys.connect();
  await clock.advance(0);
  assert.deepEqual(
    fake.calendars.map((c) => c.user),
    ['zoe'],
  );
});

test('the past is never pruned: an event before the window stays', async (t) => {
  const old = {
    calendar_external_id: CAL('pepper', 'DE-BY'),
    external_id: `${CAL('pepper', 'DE-BY')}:old-summer`,
    name: 'Sommerferien',
    start: '2026-08-03',
    end: '2026-09-15',
    full_day: true,
  };
  const { app, fake } = await setup({
    calendars: [
      {
        user: 'pepper',
        external_id: CAL('pepper', 'DE-BY'),
        selector: 'x',
        name: 'x',
        description: '',
        color: '#3174ad',
        sync: true,
        shared: true,
      },
    ],
    calendarEvents: [old],
  });
  t.after(() => app.stop());
  assert.ok(fake.calendarEvents.some((e) => e.external_id === old.external_id));
  assert.equal(fake.calendars[0].shared, true, 'the user-owned flags untouched');
});

test('Gladys unreadable on connection: tried again 10 s, 20 s... later, then synced', async (t) => {
  const { app, fake, clock } = await setup({ connect: false });
  t.after(() => app.stop());
  const real = app.gladys.getCalendarAccounts.bind(app.gladys);
  let failures = 2;
  let calls = 0;
  app.gladys.getCalendarAccounts = async () => {
    calls += 1;
    if (failures > 0) {
      failures -= 1;
      throw Object.assign(new Error('boom'), { status: 500 });
    }
    return real();
  };
  await app.gladys.connect();
  await clock.advance(0);
  assert.equal(calls, 1);
  assert.match(fake.connectionStatus.message.en, /next try in 10 s/);
  await clock.advance(9 * SECOND);
  assert.equal(calls, 1);
  await clock.advance(2 * SECOND);
  assert.equal(calls, 2);
  assert.match(fake.connectionStatus.message.en, /next try in 20 s/);
  await clock.advance(21 * SECOND);
  assert.equal(calls, 3);
  assert.equal(fake.calendars.length, 1);
  assert.equal(fake.connectionStatus.connected, true);
});

test('a 429 of Gladys: one more try a minute later', async (t) => {
  const { app, fake, clock } = await setup({ connect: false });
  t.after(() => app.stop());
  const real = app.gladys.publishCalendarEvents.bind(app.gladys);
  let refused = 1;
  app.gladys.publishCalendarEvents = async (...args) => {
    if (refused-- > 0) throw Object.assign(new Error('slow down'), { status: 429 });
    return real(...args);
  };
  await app.gladys.connect();
  await clock.advance(0);
  assert.equal(fake.publishedCalendarEvents.length, 0);
  await clock.advance(61 * SECOND);
  assert.equal(fake.publishedCalendarEvents.length, 1);
});

test('a write refused by Gladys (400) is reported; the next pass tries again', async (t) => {
  const { app, fake, clock } = await setup({ connect: false });
  t.after(() => app.stop());
  const real = app.gladys.publishCalendarEvents.bind(app.gladys);
  let refused = 1;
  app.gladys.publishCalendarEvents = async (...args) => {
    if (refused-- > 0) throw Object.assign(new Error('bad'), { status: 400 });
    return real(...args);
  };
  await app.gladys.connect();
  await clock.advance(0);
  assert.match(
    fake.connectionStatus.message.fr,
    /Gladys a refusé le calendrier Bayern \(HTTP 400\)/,
  );
  await clock.advance(HOUR);
  assert.equal(fake.publishedCalendarEvents.length, 1);
});

test('30 calendar writes a minute in Gladys: never more than 25 in any minute', async (t) => {
  const accounts = [];
  for (let i = 0; i < 12; i += 1) {
    accounts.push(account(`user${i}`, { country: 'DE', regions: 'BY, BE' }));
  }
  const { app, fake, clock } = await setup({ accounts, connect: false });
  t.after(() => app.stop());
  const stamps = [];
  for (const name of ['publishCalendars', 'publishCalendarEvents', 'deleteCalendar']) {
    const real = app.gladys[name].bind(app.gladys);
    app.gladys[name] = async (...args) => {
      stamps.push(clock.monotonic());
      return real(...args);
    };
  }
  await app.gladys.connect();
  await clock.advance(5 * MINUTE);
  assert.equal(stamps.length, 36, '12 calendar lists + 24 event windows');
  for (let i = 0; i + 25 < stamps.length; i += 1) {
    assert.ok(stamps[i + 25] - stamps[i] >= MINUTE, `writes ${i}..${i + 25} within a minute`);
  }
  assert.equal(fake.calendars.length, 24);
});

test('/data unreadable: never overwritten, read again every 10 s, used once readable', async (t) => {
  const store = createMemoryStore({
    catalogs: {},
  });
  store.unreadable = true;
  const { app, clock, net } = await setup({ store });
  t.after(() => app.stop());
  assert.equal(store.saves, 0, 'an unread /data is never written');
  assert.ok(net.calls.length > 0, 'the calendars are filled all the same');
  const loads = store.loads;
  await clock.advance(10 * SECOND + 10);
  assert.equal(store.loads, loads + 1);
  store.unreadable = false;
  await clock.advance(10 * SECOND + 10);
  assert.ok(store.saves > 0, 'written once read');
  assert.ok(store.data.holidays['DE|DE-BY'].items.length >= 8);
});

test('/data that hangs: the button still answers, one read at a time', async (t) => {
  const store = createMemoryStore();
  store.hang = true;
  const { app, clock, fake } = await setup({ store });
  t.after(() => app.stop());
  await clock.advance(35 * SECOND);
  assert.equal(store.loads, 1, 'never a second read while the first hangs');
  const ack = await fake.action('list_regions', { country: 'DE' });
  assert.equal(ack.success, true);
  assert.match(ack.data.message.fr, /DE-BY – Bayern/);
});

test('/data that hangs across a reconnection: still one read, its late answer used', async (t) => {
  const store = createMemoryStore();
  let release;
  store.load = () => {
    store.loads += 1;
    return new Promise((resolve) => {
      release = () => resolve({});
    });
  };
  const { app, clock, gladys } = await setup({ store });
  t.after(() => app.stop());
  await app.stop();
  await gladys.disconnect();
  await gladys.connect();
  await clock.advance(25 * SECOND);
  assert.equal(store.loads, 1, 'no second read beside the hung one');
  assert.equal(store.saves, 0);
  release();
  await clock.advance(0);
  assert.equal(app.loaded, true);
  assert.ok(store.saves > 0, 'written once read');
});

test('/data saved that cannot be written: the integration goes on', async (t) => {
  const store = createMemoryStore();
  store.failSave = true;
  const { app, fake } = await setup({ store });
  t.after(() => app.stop());
  assert.equal(fake.calendars.length, 1);
  assert.ok(fake.publishedCalendarEvents.length === 1);
});

test('the "List the regions" button: codes and names, cached a week, no request when paused', async (t) => {
  const { app, fake, net } = await setup({ accounts: [] });
  t.after(() => app.stop());
  const de = await fake.action('list_regions', { country: 'DE' });
  assert.match(de.data.message.en, /^Regions of Germany \(code – name\): DE-BB – Brandenburg/);
  assert.match(de.data.message.en, /DE-BY – Bavaria/);
  assert.match(de.data.message.fr, /DE-BY – Bayern/, 'no French name: the first one');
  await fake.action('list_regions', { country: 'DE' });
  assert.equal(net.count('Subdivisions?countryIsoCode=DE'), 1, 'one read for two clicks');
  const lu = await fake.action('list_regions', { country: 'LU' });
  assert.match(lu.data.message.fr, /Luxembourg n’a pas de région/);
  const bad = await fake.action('list_regions', { country: 'FR' });
  assert.match(bad.data.message.en, /Choose one of the countries offered/);
  net.fail = 503;
  const be = await fake.action('list_regions', { country: 'BE' });
  assert.match(be.data.message.en, /could not be read \(HTTP 503\)/);
  const at = net.calls.length;
  await fake.action('list_regions', { country: 'BE' });
  assert.equal(net.calls.length, at, 'paused: no request for a click');
});

test('stop: no timer left, no request nor write after it', async (t) => {
  const { app, clock, net, fake } = await setup();
  await app.stop();
  t.after(() => app.stop());
  assert.equal(clock.pending.size, 0);
  const calls = net.calls.length;
  const sent = fake.requests.length;
  await clock.advance(2 * DAY);
  assert.equal(net.calls.length, calls);
  assert.equal(fake.requests.length, sent);
});

test('reconnection: everything resent once, still no request to the API', async (t) => {
  const { app, clock, net, fake, gladys } = await setup();
  t.after(() => app.stop());
  const calls = net.calls.length;
  const pushes = fake.publishedCalendarEvents.length;
  await app.stop();
  await gladys.disconnect();
  await gladys.connect();
  await clock.advance(0);
  assert.equal(net.calls.length, calls);
  assert.equal(fake.publishedCalendarEvents.length, pushes + 1);
  await settle();
});

test('a new month moves the window: still one read a day, the window republished', async (t) => {
  const clock = createFakeClock(Date.parse('2026-11-30T23:00:00Z'));
  const { app, fake, net } = await setup({ clock });
  t.after(() => app.stop());
  assert.equal(holidayCalls(net), 1);
  await clock.advance(2 * HOUR);
  assert.equal(holidayCalls(net), 1, 'read 2 h ago: not again for the new month');
  assert.deepEqual(fake.publishedCalendarEvents.at(-1).window, {
    from: '2026-12-01T12:00:00.000Z',
    to: '2028-01-01T12:00:00.000Z',
  });
  for (const e of fake.publishedCalendarEvents.at(-1).events) assert.ok(e.end > '2026-12-01');
  await clock.advance(23 * HOUR);
  assert.equal(holidayCalls(net), 2, 'a day after the last read');
  assert.ok(net.calls.at(-1).url.includes('validFrom=2026-12-01&validTo=2028-01-01'));
});

test('Austria: Länder with non-ASCII codes (AT-KÄ), by name, ISO code or API code', async (t) => {
  for (const entry of ['Kärnten', 'kaernten', 'AT-2', 'at-kä', 'KÄ', 'Carinthia']) {
    const { app, fake, net } = await setup({
      accounts: [account('pepper', { country: 'AT', regions: entry }, 'de')],
    });
    t.after(() => app.stop());
    if (entry === 'kaernten') {
      assert.match(fake.connectionStatus.message.en, /region "kaernten" unknown in Austria/);
      await app.stop();
      continue;
    }
    assert.deepEqual(
      fake.calendars.map((c) => [c.external_id, c.name]),
      [[CAL('pepper', 'AT-KÄ'), 'School holidays – Kärnten']],
      entry,
    );
    assert.ok(net.calls.some((c) => c.url.includes('subdivisionCode=AT-K%C3%84')));
    assert.ok(fake.calendarEvents.length >= 8);
    assert.ok(
      fake.calendarEvents.every((e) => e.external_id.startsWith(`${CAL('pepper', 'AT-KÄ')}:`)),
    );
    await app.stop();
  }
  const { app, fake } = await setup({ accounts: [] });
  t.after(() => app.stop());
  const at = await fake.action('list_regions', { country: 'AT' });
  for (const code of ['AT-KÄ', 'AT-NÖ', 'AT-OÖ', 'AT-WI'])
    assert.ok(at.data.message.en.includes(code), code);
  assert.match(at.data.message.fr, /AT-NÖ – Niederösterreich/);
});

test('Switzerland: districts with non-ASCII codes kept, found by code', async (t) => {
  const { app, fake, net } = await setup({
    accounts: [account('pepper', { country: 'CH', regions: 'CH-BE-SL-RÜ' }, 'fr')],
  });
  t.after(() => app.stop());
  assert.deepEqual(
    fake.calendars.map((c) => c.external_id),
    [CAL('pepper', 'CH-BE-SL-RÜ')],
  );
  assert.ok(net.calls.some((c) => c.url.includes('subdivisionCode=CH-BE-SL-R%C3%9C')));
});

test('an unreadable 200 is an outage: paused, the status says so', async (t) => {
  for (const [label, body] of [
    ['html', '<html>maintenance</html>'],
    ['object', '{"a":1}'],
    ['invalid utf-8', new Uint8Array([0x5b, 0xff, 0xfe, 0x5d])],
    ['empty', ''],
  ]) {
    const net = createNet();
    net.override = (url) =>
      url.includes('SchoolHolidays') ? new Response(body, { status: 200 }) : undefined;
    const { app, fake, clock } = await setup({ net });
    t.after(() => app.stop());
    assert.equal(fake.connectionStatus.connected, false, label);
    assert.match(fake.connectionStatus.message.en, /unreachable \(parse\)/, label);
    const calls = net.calls.length;
    await clock.advance(50 * SECOND);
    assert.equal(net.calls.length, calls, `${label}: paused`);
    await clock.advance(15 * SECOND);
    assert.equal(net.count('SchoolHolidays'), 2, `${label}: read again after the pause`);
    await app.stop();
  }
});

test('more than 500 holidays: refused, said, not an outage, read again the next day', async (t) => {
  const net = createNet();
  const many = Array.from({ length: 501 }, (_, i) => ({
    id: `h${i}`,
    startDate: '2027-01-01',
    endDate: '2027-01-02',
    type: 'School',
    name: [{ language: 'DE', text: 'x' }],
  }));
  net.override = (url) => (url.includes('SchoolHolidays') ? json(many) : undefined);
  const { app, fake, clock } = await setup({ net });
  t.after(() => app.stop());
  assert.equal(fake.connectionStatus.connected, true);
  assert.match(fake.connectionStatus.message.fr, /trop de vacances pour Bayern, rien publié/);
  assert.equal(fake.publishedCalendarEvents.length, 0);
  await clock.advance(5 * HOUR);
  assert.equal(net.count('SchoolHolidays'), 1);
  net.override = undefined;
  await clock.advance(20 * HOUR);
  assert.equal(net.count('SchoolHolidays'), 2);
  assert.equal(fake.publishedCalendarEvents.length, 1);
  assert.doesNotMatch(fake.connectionStatus.message.fr, /trop de vacances/);
});

test('stop during a request: the request cut, no pause armed, nothing written after', async (t) => {
  const net = createNet();
  const store = createMemoryStore();
  let signal;
  net.override = (url, init) => {
    if (!url.includes('SchoolHolidays')) return undefined;
    signal = init.signal;
    return new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () =>
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
      );
    });
  };
  const { app, clock } = await setup({ net, store });
  t.after(() => app.stop());
  assert.ok(signal && !signal.aborted);
  const saves = store.saves;
  await app.stop();
  await settle();
  assert.equal(signal.aborted, true);
  assert.equal(clock.pending.size, 0, 'no timer after stop');
  assert.equal(store.saves, saves, 'no write after stop');
  assert.equal(app.pause.until, 0);
});

test('an empty answer after holidays: kept and said twice, accepted the third day', async (t) => {
  const net = createNet();
  const { app, fake, clock } = await setup({ net });
  t.after(() => app.stop());
  const events = fake.calendarEvents.length;
  assert.ok(events >= 8);
  net.override = (url) => (url.includes('SchoolHolidays') ? json([]) : undefined);
  await clock.advance(25 * HOUR);
  assert.equal(net.count('SchoolHolidays'), 2);
  assert.equal(fake.calendarEvents.length, events, 'kept');
  assert.match(
    fake.connectionStatus.message.en,
    /no holiday for Bayern, the previous ones are kept/,
  );
  await clock.advance(25 * HOUR);
  assert.equal(net.count('SchoolHolidays'), 3);
  assert.equal(fake.calendarEvents.length, events, 'kept a second time');
  await clock.advance(25 * HOUR);
  assert.equal(net.count('SchoolHolidays'), 4);
  assert.equal(fake.calendarEvents.length, 0, 'the third empty answer is the truth');
  assert.doesNotMatch(fake.connectionStatus.message.en, /previous ones are kept/);
});

test('a user selector Gladys would not give is skipped; a 403 is not a refusal', async (t) => {
  const { app, fake, clock } = await setup({
    connect: false,
    accounts: [
      account('../x', { country: 'DE', regions: 'Bayern' }),
      account('pepper', { country: 'DE', regions: 'Bayern' }),
    ],
  });
  t.after(() => app.stop());
  app.gladys.publishCalendarEvents = async () => {
    throw Object.assign(new Error('not synced'), { status: 403 });
  };
  await app.gladys.connect();
  await clock.advance(0);
  assert.deepEqual(
    fake.publishedCalendars.map((p) => p.user),
    ['pepper'],
  );
  assert.doesNotMatch(fake.connectionStatus.message.en, /refused/);
  assert.match(fake.connectionStatus.message.en, /^1 user\(s\)/);
});

test('a click and a pass at once: one request for the regions', async (t) => {
  const net = createNet();
  let release;
  const gate = new Promise((r) => (release = r));
  net.override = async (url) => {
    if (url.includes('Subdivisions')) await gate;
    return undefined;
  };
  const { app, fake, clock } = await setup({ net });
  t.after(() => app.stop());
  const click = fake.action('list_regions', { country: 'DE' });
  await settle();
  release();
  const ack = await click;
  await clock.advance(0);
  assert.match(ack.data.message.en, /DE-BY/);
  assert.equal(net.count('Subdivisions?countryIsoCode=DE'), 1);
  assert.equal(fake.calendars.length, 1);
});

test('a failed read keeps publishing the holidays read before', async (t) => {
  const { app, fake, clock, net } = await setup();
  t.after(() => app.stop());
  net.fail = 503;
  fake.calendars[0].sync = true;
  await clock.advance(25 * HOUR);
  assert.equal(net.count('SchoolHolidays'), 2);
  // A reconnection resends: from the old data.
  await app.stop();
  await app.gladys.disconnect();
  await app.gladys.connect();
  await clock.advance(0);
  assert.ok(fake.publishedCalendarEvents.at(-1).events.length >= 8);
});

test('a user without language: the English names', async (t) => {
  const { app, fake } = await setup({
    accounts: [{ user: { selector: 'pepper' }, config: { country: 'DE', regions: 'Bayern' } }],
  });
  t.after(() => app.stop());
  assert.equal(fake.calendars[0].name, 'School holidays – Bavaria');
  assert.ok(fake.calendarEvents.some((e) => e.name === 'Christmas Holidays'));
});
