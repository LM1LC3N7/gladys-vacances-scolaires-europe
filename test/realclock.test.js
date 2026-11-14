// -----------------------------------------------------------------------------
// On a real clock (sped up): the check every hour, never faster; the API read
// once a day, never faster. Cleanup in t.after: a failing test never leaves
// the app running.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { HolidaysApp } from '../src/app.js';
import { registerHandlers } from '../src/handlers.js';
import { createMemoryStore } from '../src/store.js';
import { HOUR, NOW, SELECTOR, account, createNet, quiet } from './helpers/app.js';
import { measurePeriod, realClock, spyOn } from './helpers/realclock.js';

async function start(t, speed) {
  const clock = realClock({ speed, start: NOW });
  const net = createNet();
  const gladys = createFakeGladys({
    selector: SELECTOR,
    calendarAccounts: [account('pepper', { country: 'DE', regions: 'Bayern' })],
  });
  const app = new HolidaysApp({
    gladys,
    fetch: net.fetch,
    store: createMemoryStore(),
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    logger: quiet,
  });
  registerHandlers(gladys, app, quiet);
  t.after(async () => {
    await app.stop();
    clock.close();
  });
  return { app, clock, net, gladys };
}

test('real clock: the check every hour, never faster', async (t) => {
  const speed = 20_000;
  const { app, clock, gladys } = await start(t, speed);
  const calls = spyOn(app, 'check', clock);
  await gladys.connect();
  await measurePeriod(calls, { count: 3, period: HOUR, speed });
  await app.stop();
  assert.equal(clock.pending, 0);
});

test('real clock: the holidays read once a day, never faster', async (t) => {
  const speed = 200_000;
  const { app, clock, net, gladys } = await start(t, speed);
  const reads = [];
  const fetch = net.fetch;
  app.api.fetch = (url, init) => {
    if (url.includes('SchoolHolidays')) reads.push(clock.monotonic());
    return fetch(url, init);
  };
  await gladys.connect();
  await measurePeriod(reads, { count: 2, period: 24 * HOUR, max: 1.2, speed });
});
