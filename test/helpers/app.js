// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, a scripted network (fake fetch by
// URL, answers recorded from the real API in test/fixtures) and a virtual
// clock that only moves when the test says so — each read of a clock moves it
// 1 µs, so a decision reading it twice is caught. Nothing touches the network.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { HolidaysApp } from '../../src/app.js';
import { registerHandlers } from '../../src/handlers.js';
import { createMemoryStore } from '../../src/store.js';

export const SELECTOR = 'vacances-scolaires-europe';
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
// Saturday 14 November 2026, 10:00 UTC: window 2026-11-01 .. 2027-12-01.
export const NOW = Date.parse('2026-11-14T10:00:00Z');
export const API = 'https://openholidaysapi.org/';
export const WINDOW = { from: '2026-11-01T12:00:00.000Z', to: '2027-12-01T12:00:00.000Z' };

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));

export const CAL = (user, code) => `ext:${SELECTOR}:${user}:${code}`;

export function account(selector, config, language = 'fr') {
  return { user: { selector, first_name: selector, language }, config };
}

/** Lets every pending promise run (a few event-loop turns). */
export async function settle(turns = 30) {
  for (let i = 0; i < turns; i += 1) await new Promise((r) => setImmediate(r));
}

export function createFakeClock(start = NOW) {
  let wall = start;
  let mono = 1_000_000;
  let nextId = 1;
  const pending = new Map();
  const clock = {
    now: () => (wall += 0.001),
    monotonic: () => (mono += 0.001),
    timers: {
      setTimeout(fn, ms) {
        const id = nextId++;
        pending.set(id, { fn, at: mono + Math.max(0, Number(ms) || 0) });
        return id;
      },
      clearTimeout(id) {
        pending.delete(id);
      },
    },
    pending,
    /** Moves both clocks by `ms`, firing the due timers in order. */
    async advance(ms) {
      const target = mono + ms;
      await settle();
      for (let i = 0; i < 100_000; i += 1) {
        let next;
        for (const [id, timer] of pending) {
          if (timer.at <= target && (!next || timer.at < next.timer.at)) next = { id, timer };
        }
        if (!next) break;
        pending.delete(next.id);
        const step = Math.max(0, next.timer.at - mono);
        mono += step;
        wall += step;
        next.timer.fn();
        await settle();
      }
      const rest = Math.max(0, target - mono);
      mono += rest;
      wall += rest;
      await settle();
    },
    /** Moves the wall clock only (a clock set back or forward). */
    jumpWall(ms) {
      wall += ms;
    },
  };
  return clock;
}

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/**
 * The API as recorded: Subdivisions/Groups of DE, BE, LU, AT, CH (Bern only);
 * school holidays of DE-BY, DE-BE, BE-FR (group), LU and AT-KÄ. `net.fail` answers every request with
 * that status (or a function of the URL); `calls` records every request.
 */
export function createNet() {
  const answers = {
    'Subdivisions?countryIsoCode=DE': fixture('subdivisions-DE'),
    'Groups?countryIsoCode=DE': fixture('groups-DE'),
    'Subdivisions?countryIsoCode=BE': fixture('subdivisions-BE'),
    'Groups?countryIsoCode=BE': fixture('groups-BE'),
    'Subdivisions?countryIsoCode=LU': [],
    'Groups?countryIsoCode=LU': [],
    'Subdivisions?countryIsoCode=AT': fixture('subdivisions-AT'),
    'Groups?countryIsoCode=AT': [],
    'Subdivisions?countryIsoCode=CH': fixture('subdivisions-CH-BE'),
    'Groups?countryIsoCode=CH': [],
  };
  const net = {
    calls: [],
    fail: undefined,
    hang: false,
    override: undefined,
    fetch: async (url, init = {}) => {
      net.calls.push({ url, headers: init.headers ?? {} });
      if (net.hang) {
        return new Promise((resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        });
      }
      if (net.override) {
        const r = await net.override(url, init);
        if (r) return r;
      }
      if (net.fail !== undefined) {
        const status = typeof net.fail === 'function' ? net.fail(url) : net.fail;
        if (status === 'offline') throw Object.assign(new Error('offline'), { code: 'ENOTFOUND' });
        if (status) return json({ title: 'error' }, status);
      }
      const u = new URL(url);
      const path = u.pathname.slice(1);
      const q = u.searchParams;
      if (path === 'SchoolHolidays') {
        const code = q.get('subdivisionCode') ?? q.get('groupCode') ?? q.get('countryIsoCode');
        const name = {
          'DE-BY': 'DE-BY',
          'DE-BE': 'DE-BE',
          'BE-FR': 'BE-FR',
          LU: 'LU',
          'AT-KÄ': 'AT-KA',
        }[code];
        return json(name ? fixture(`holidays-${name}`) : []);
      }
      const answer = answers[`${path}?countryIsoCode=${q.get('countryIsoCode')}`];
      return answer ? json(answer) : json([]);
    },
    count: (part) => net.calls.filter((c) => c.url.includes(part)).length,
  };
  return net;
}

export const quiet = { info() {}, warn() {}, error() {}, debug() {} };

/** The app on a fake Gladys, connected (start() run), its pass settled. */
export async function setup({
  accounts = [account('pepper', { country: 'DE', regions: 'Bayern' })],
  calendars,
  calendarEvents,
  store = createMemoryStore(),
  net = createNet(),
  clock = createFakeClock(),
  connect = true,
} = {}) {
  const gladys = createFakeGladys({
    selector: SELECTOR,
    calendarAccounts: accounts,
    calendars,
    calendarEvents,
  });
  const logs = [];
  const logger = {
    info: (m) => logs.push(m),
    warn: (m) => logs.push(m),
    error: (m) => logs.push(m),
    debug: () => {},
  };
  const app = new HolidaysApp({
    gladys,
    fetch: net.fetch,
    store,
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    logger,
  });
  registerHandlers(gladys, app, quiet);
  if (connect) {
    await gladys.connect();
    await clock.advance(0);
  }
  return { gladys, fake: gladys.fake, app, net, clock, store, logs };
}

/** Requests to the fake Gladys whose path starts with `prefix` (POST/DELETE). */
export const writes = (fake) =>
  fake.requests.filter((r) => r.method !== 'GET' && r.path.startsWith('/calendar'));
