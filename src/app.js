// -----------------------------------------------------------------------------
// The integration: for every user who enabled it in Gladys ("My calendars"),
// one calendar per chosen region, filled with the school holidays read from
// OpenHolidays.
//
// - One sync at a time (a coalescing queue): a full pass on connection and
//   every hour, a pass for one user when they change their account.
// - The API is read at most once a day per region (once a week for the lists
//   of regions), whatever the passes, restarts or clicks: the date of the data
//   and of the last attempt are kept in /data. A failure pauses EVERY request
//   to the API (60 s, doubled, 6 h at most, Retry-After honoured), persisted.
// - Gladys accepts 30 calendar writes a minute: 25 at most here, and a write
//   is skipped when what it would send was already sent (same content).
// - Decisions on durations use the monotonic clock; the wall clock only dates
//   the data in /data and gives the month of the window.
// -----------------------------------------------------------------------------

import {
  ACTIONS,
  ATTEMPT_GAP,
  CATALOG_TTL,
  CHECK_EVERY,
  COUNTRY_CODES,
  GLADYS_429_WAIT,
  GLADYS_RETRY_MAX,
  GLADYS_RETRY_MIN,
  HOLIDAYS_TTL,
  MINUTE,
  PAUSE_MAX,
  PAUSE_MIN,
  WRITES_PER_MINUTE,
  WRITE_WINDOW,
  countryOf,
} from './constants.js';
import { buildCalendar, buildEvents, problemsText, regionName } from './events.js';
import { HttpError } from './http.js';
import { both, t } from './i18n.js';
import { CODE, OpenHolidaysClient, pick } from './openholidays.js';
import { resolveRegion, splitRegions } from './regions.js';
import { FileStore } from './store.js';
import { isDate, windowAt } from './time.js';

const USER_SELECTOR = /^[a-z0-9][a-z0-9-]{0,99}$/i;
const STORE_RETRY = 10_000;
// Entries of /data not used for 60 days are forgotten.
const FORGET_AFTER = 60 * 24 * 60 * MINUTE;
const MAX_USERS = 200;

class Stopped extends Error {}

const isTexts = (v) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.entries(v).every(([k, x]) => /^[A-Z]{2}$/.test(k) && typeof x === 'string');

/** An entry of /data read back: the shape the code wrote, else dropped. */
const validHoliday = (h) =>
  h &&
  typeof h.id === 'string' &&
  /^[A-Za-z0-9-]{1,64}$/.test(h.id) &&
  isDate(h.start) &&
  isDate(h.end) &&
  h.end >= h.start &&
  isTexts(h.names) &&
  Object.keys(h.names).length > 0 &&
  isTexts(h.comments ?? {}) &&
  (h.groups === undefined ||
    (Array.isArray(h.groups) && h.groups.every((g) => typeof g === 'string' && CODE.test(g))));
const REGION_CODE = { test: (code) => CODE.test(code) && code.includes('-') };
const validRegion = (r) =>
  r &&
  typeof r.code === 'string' &&
  REGION_CODE.test(r.code) &&
  (r.iso === undefined || (typeof r.iso === 'string' && REGION_CODE.test(r.iso))) &&
  isTexts(r.names);

/** The short reason of an error, never its whole message (no URL, no payload). */
export function reasonOf(err) {
  if (err instanceof HttpError) return err.status ? `HTTP ${err.status}` : err.code;
  if (err?.status) return `HTTP ${err.status}`;
  return err?.code ?? err?.name ?? 'error';
}

export class HolidaysApp {
  constructor({
    gladys,
    fetch: fetchImpl = globalThis.fetch,
    store = new FileStore({ name: 'state.json' }),
    now = Date.now,
    monotonic = () => performance.now(),
    timers = { setTimeout, clearTimeout },
    logger = console,
  }) {
    this.gladys = gladys;
    this.store = store;
    this.now = now;
    this.mono = monotonic;
    this.timers = timers;
    this.logger = logger;
    this.api = new OpenHolidaysClient({ fetch: fetchImpl, now, timers });
    // Regions whose last answer had too many holidays (keys of readAt).
    this.tooMany = new Set();
    // Enabled users beyond MAX_USERS at the last full pass (said in the status).
    this.overUsers = 0;
    this.abort = null;
    // /data, as last read or written.
    this.data = { holidays: {}, catalogs: {}, attempts: {} };
    this.loaded = false;
    this.loading = false;
    // The API pause (monotonic deadline), its level and reason.
    this.pause = { until: 0, level: 0, reason: '' };
    // Successful reads in this process, by key (monotonic): never more often
    // than the TTL even when the wall clock jumps back.
    this.readAt = new Map();
    this.inflight = new Map();
    // What was last sent to Gladys, by calendar or user: skipped when equal.
    this.sent = new Map();
    this.writes = [];
    this.problems = new Map();
    this.calendarCount = new Map();
    this.pendingAll = false;
    this.pendingUsers = new Set();
    this.running = false;
    this.gen = 0;
    this.started = false;
    this.timer = { check: null, pause: null, gladys: null, store: null, storeWatch: null };
    this.gladysRetry = 0;
    this.lastStatus = '';
  }

  // ---------------------------------------------------------------- lifecycle

  /** Called on every (re)connection to Gladys: a full pass, everything resent. */
  async start() {
    if (!this.started) {
      this.started = true;
      this.gen += 1;
      // stop() cuts the request in flight.
      this.abort = new AbortController();
      this.api.signal = this.abort.signal;
      this.loadData();
      this.scheduleCheck();
    }
    this.sent.clear();
    this.lastStatus = '';
    if (this.paused()) this.armPauseTimer();
    this.requestAll();
  }

  async stop() {
    this.started = false;
    this.gen += 1;
    for (const key of Object.keys(this.timer)) {
      if (this.timer[key]) this.timers.clearTimeout(this.timer[key]);
      this.timer[key] = null;
    }
    this.pendingAll = false;
    this.pendingUsers.clear();
    this.abort?.abort();
    if (this.sleeping) {
      this.timers.clearTimeout(this.sleeping.id);
      this.sleeping.resolve();
    }
    // The last write of /data, if it lands within 2 s (a hung volume never
    // blocks the shutdown).
    await this.bounded(this.store.flush?.());
  }

  /** `promise`, or nothing after `ms` (never rejects). */
  bounded(promise, ms = 2000) {
    let id;
    const limit = new Promise((resolve) => {
      id = this.timers.setTimeout(resolve, ms);
    });
    return Promise.race([Promise.resolve(promise).catch(() => {}), limit]).finally(() =>
      this.timers.clearTimeout(id),
    );
  }

  alive(gen) {
    if (gen !== this.gen || !this.started) throw new Stopped();
  }

  scheduleCheck() {
    if (this.timer.check) this.timers.clearTimeout(this.timer.check);
    this.timer.check = this.timers.setTimeout(() => {
      this.timer.check = null;
      if (!this.started) return;
      this.scheduleCheck();
      this.check();
    }, CHECK_EVERY);
  }

  /** The hourly check: a full pass (nothing is read or sent unless due). */
  check() {
    this.requestAll();
  }

  // ---------------------------------------------------------------- /data

  /** Reads /data once; unreadable or slow, read again on its own timer (10 s). */
  loadData() {
    if (this.loaded || this.loading || !this.started) return;
    this.loading = true;
    // A read that hangs: said every 10 s, never a second read beside it.
    const watch = () => {
      this.timer.storeWatch = this.timers.setTimeout(() => {
        this.timer.storeWatch = null;
        if (!this.loading || !this.started) return;
        this.logger.warn?.('/data slow to answer, still waiting');
        watch();
      }, STORE_RETRY);
    };
    watch();
    const settled = () => {
      this.loading = false;
      if (this.timer.storeWatch) this.timers.clearTimeout(this.timer.storeWatch);
      this.timer.storeWatch = null;
    };
    // The answer is used even when it comes after a reconnection (a read that
    // hung across it): data is data; only the timers belong to the app running.
    this.store.load().then(
      (data) => {
        settled();
        this.merge(data);
        this.loaded = true;
        this.logger.info?.('State read from /data');
        // What was read while /data could not be: written now.
        this.persist();
      },
      (err) => {
        settled();
        if (!this.started) return;
        this.logger.warn?.(`/data unreadable (${reasonOf(err)}), read again in 10 s`);
        this.timer.store = this.timers.setTimeout(() => {
          this.timer.store = null;
          this.loadData();
        }, STORE_RETRY);
      },
    );
  }

  /** What /data says, merged with what this process already knows. */
  merge(saved) {
    const nowWall = this.now();
    const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
    const valid = (at) => Number.isFinite(at) && at <= nowWall + MINUTE;
    for (const kind of ['holidays', 'catalogs']) {
      const entries = isObject(saved?.[kind]) ? saved[kind] : {};
      for (const [key, entry] of Object.entries(entries)) {
        if (!isObject(entry) || !valid(entry.fetchedAt) || !Array.isArray(entry.items)) continue;
        const items = entry.items.filter(kind === 'holidays' ? validHoliday : validRegion);
        const mine = this.data[kind][key];
        if (!mine || mine.fetchedAt < entry.fetchedAt) this.data[kind][key] = { ...entry, items };
      }
    }
    const attempts = isObject(saved?.attempts) ? saved.attempts : {};
    for (const [key, at] of Object.entries(attempts)) {
      if (valid(at) && !(this.data.attempts[key] >= at)) this.data.attempts[key] = at;
    }
    // A pause in /data: kept for what is left of it; a date further than the
    // longest pause is not ours (clock change, foreign file): ignored.
    const p = saved?.pause;
    if (isObject(p) && Number.isFinite(p.untilWall)) {
      const left = p.untilWall - nowWall;
      if (left > 0 && left <= PAUSE_MAX) {
        const until = this.mono() + left;
        if (until > this.pause.until) {
          this.pause = {
            until,
            untilWall: p.untilWall,
            level: Math.min(Number.isInteger(p.level) ? p.level : 1, 12),
            reason: typeof p.reason === 'string' ? p.reason.slice(0, 40) : '',
          };
          this.armPauseTimer();
        }
      }
    }
  }

  /** Writes /data (only once read: an unread /data is never overwritten). */
  async persist() {
    if (!this.loaded || !this.started) return;
    const nowWall = this.now();
    for (const kind of ['holidays', 'catalogs']) {
      for (const [key, entry] of Object.entries(this.data[kind])) {
        if (nowWall - (entry.usedAt ?? entry.fetchedAt) > FORGET_AFTER) delete this.data[kind][key];
      }
    }
    for (const [key, at] of Object.entries(this.data.attempts)) {
      if (nowWall - at > FORGET_AFTER) delete this.data.attempts[key];
    }
    const pauseLeft = this.pause.until - this.mono();
    const payload = {
      version: 1,
      ...this.data,
      pause:
        pauseLeft > 0
          ? {
              untilWall: nowWall + pauseLeft,
              level: this.pause.level,
              reason: this.pause.reason,
            }
          : { level: this.pause.level },
    };
    try {
      await this.store.save(payload);
    } catch (err) {
      this.logger.warn?.(`/data not written (${reasonOf(err)})`);
    }
  }

  // ---------------------------------------------------------------- API reads

  paused() {
    return this.pause.until > this.mono();
  }

  armPauseTimer() {
    if (this.timer.pause) this.timers.clearTimeout(this.timer.pause);
    const left = Math.max(0, this.pause.until - this.mono());
    this.timer.pause = this.timers.setTimeout(() => {
      this.timer.pause = null;
      if (this.started) this.requestAll();
    }, left + 1000);
  }

  /** A failed read: every request paused, 60 s doubled up to 6 h (Retry-After within). */
  failed(err) {
    const level = Math.min(this.pause.level + 1, 12);
    let wait = Math.min(PAUSE_MAX, PAUSE_MIN * 2 ** (level - 1));
    if (Number.isFinite(err?.retryAfter)) {
      wait = Math.min(PAUSE_MAX, Math.max(PAUSE_MIN, err.retryAfter, wait));
    }
    this.pause = { until: this.mono() + wait, level, reason: reasonOf(err) };
    this.armPauseTimer();
    this.logger.warn?.(
      `OpenHolidays read failed (${reasonOf(err)}), requests paused ${Math.round(wait / 1000)} s`,
    );
  }

  /**
   * The entry `kind`/`key` of /data, read again from the API when due and
   * allowed: older than `ttl` (or for another window), not read by this
   * process within `ttl`, no attempt in the last minute, no pause. Returns the
   * entry (maybe stale) or undefined when there is none.
   */
  async cached(kind, key, ttl, read, { fromDate, toDate } = {}) {
    const entry = this.data[kind][key];
    const nowWall = this.now();
    const age = entry ? nowWall - entry.fetchedAt : Infinity;
    // Fresh for a day whatever the window: at the turn of a month the window
    // moves, the holidays read a few hours before still serve (the new last
    // month is read with the next daily read).
    const fresh = entry && age >= 0 && age < ttl;
    if (entry) entry.usedAt = nowWall;
    if (fresh) return entry;
    const attemptKey = `${kind}:${key}`;
    // A read of the same data already in flight (a click during a pass): its
    // answer is shared.
    if (this.inflight.has(attemptKey)) return this.inflight.get(attemptKey);
    const lastRead = this.readAt.get(attemptKey);
    if (lastRead !== undefined && this.mono() - lastRead < ttl) return entry;
    if (this.paused()) return entry;
    const attempt = this.data.attempts[attemptKey];
    if (Number.isFinite(attempt) && nowWall - attempt >= 0 && nowWall - attempt < ATTEMPT_GAP) {
      return entry;
    }
    const reading = this.readNow(kind, key, read, { fromDate, toDate }).finally(() =>
      this.inflight.delete(attemptKey),
    );
    this.inflight.set(attemptKey, reading);
    return reading;
  }

  async readNow(kind, key, read, { fromDate, toDate }) {
    const attemptKey = `${kind}:${key}`;
    const gen = this.gen;
    // The attempt is in /data before the request: a restart loop never reads
    // more than once a minute. A slow volume delays the read 2 s at most.
    this.data.attempts[attemptKey] = this.now();
    await this.bounded(this.persist());
    if (this.paused() || !this.started || gen !== this.gen) return this.data[kind][key];
    try {
      let items = await read();
      // Stopped meanwhile (the request was cut): nothing kept, nothing armed.
      if (!this.started || gen !== this.gen) return this.data[kind][key];
      const prev = this.data[kind][key];
      const entry = { fetchedAt: this.now(), items };
      // A region that had holidays and now has none: the API answers `[]` for
      // anything it does not know, so an empty answer is not trusted at once.
      // The holidays read before are kept (and said in the status) until the
      // third empty answer in a row, a day apart.
      if (kind === 'holidays' && items.length === 0) {
        const had = prev?.items?.some((h) => h.end >= fromDate);
        const empties = (prev?.empties ?? 0) + 1;
        if (had && empties < 3) {
          entry.items = prev.items;
          entry.empties = empties;
          this.logger.warn?.(`OpenHolidays gave no holiday for ${key}: the previous ones are kept`);
        }
      }
      if (fromDate) Object.assign(entry, { fromDate, toDate });
      entry.usedAt = entry.fetchedAt;
      this.data[kind][key] = entry;
      this.readAt.set(attemptKey, this.mono());
      this.tooMany.delete(attemptKey);
      this.pause = { until: 0, level: 0, reason: '' };
      if (this.timer.pause) this.timers.clearTimeout(this.timer.pause);
      this.timer.pause = null;
      this.persist();
      return entry;
    } catch (err) {
      if (!this.started || gen !== this.gen) return this.data[kind][key];
      if (err?.tooMany) {
        // A real answer with more holidays than a window takes: refused, read
        // again only after the TTL, said in the status.
        this.readAt.set(attemptKey, this.mono());
        this.tooMany.add(attemptKey);
        this.logger.warn?.(`OpenHolidays answer refused for ${key} (${err.message})`);
      } else {
        // Down, cut, too large, not JSON, not a list: an outage, paused.
        this.failed(err);
      }
      this.persist();
      return this.data[kind][key];
    }
  }

  /** The regions of a country (`[{ code, names, top, group }]`), undefined when never read. */
  async catalog(country) {
    const entry = await this.cached('catalogs', country, CATALOG_TTL, () =>
      this.api.catalog(country),
    );
    return entry?.items;
  }

  /** The holidays entry of a region (`{ items, empties? }`), undefined when never read. */
  async holidays(region, fromDate, toDate) {
    const key = `${region.country}|${region.code}`;
    const entry = await this.cached(
      'holidays',
      key,
      HOLIDAYS_TTL,
      () => this.api.schoolHolidays(region, fromDate, toDate),
      { fromDate, toDate },
    );
    return entry;
  }

  // ---------------------------------------------------------------- the queue

  requestAll() {
    if (!this.started) return;
    this.pendingAll = true;
    this.kick();
  }

  requestUser(userSelector) {
    if (!this.started) return;
    if (typeof userSelector === 'string') {
      // Their toggles or values changed: everything of theirs is resent.
      for (const key of [...this.sent.keys()]) {
        if (key.startsWith(`${userSelector}:`) || key === `user:${userSelector}`) {
          this.sent.delete(key);
        }
      }
      this.pendingUsers.add(userSelector);
    } else {
      this.pendingAll = true;
    }
    this.kick();
  }

  kick() {
    if (this.running) return;
    this.running = true;
    const gen = this.gen;
    (async () => {
      try {
        while (this.started && gen === this.gen && (this.pendingAll || this.pendingUsers.size)) {
          if (this.pendingAll) {
            this.pendingAll = false;
            this.pendingUsers.clear();
            await this.pass(gen, undefined);
          } else {
            const users = new Set(this.pendingUsers);
            this.pendingUsers.clear();
            await this.pass(gen, users);
          }
        }
      } catch (err) {
        if (!(err instanceof Stopped)) {
          this.logger.error?.(`Sync failed (${reasonOf(err)})`);
        }
      } finally {
        this.running = false;
        // A request arrived while the loop was ending.
        if (this.started && gen === this.gen && (this.pendingAll || this.pendingUsers.size)) {
          this.kick();
        }
      }
    })();
  }

  /** Gladys could not be read: the pass is tried again, 10 s to 5 min apart, forever. */
  gladysFailed(gen, err, users) {
    this.alive(gen);
    const wait = Math.min(GLADYS_RETRY_MAX, GLADYS_RETRY_MIN * 2 ** this.gladysRetry);
    this.gladysRetry = Math.min(this.gladysRetry + 1, 10);
    this.logger.warn?.(
      `Gladys calendar accounts unreadable (${reasonOf(err)}), next try in ${wait / 1000} s`,
    );
    this.setStatus(false, both('statusGladys', { reason: reasonOf(err), seconds: wait / 1000 }));
    if (this.timer.gladys) this.timers.clearTimeout(this.timer.gladys);
    this.timer.gladys = this.timers.setTimeout(() => {
      this.timer.gladys = null;
      if (!users) this.requestAll();
      else for (const u of users) this.requestUser(u);
    }, wait);
  }

  /** One pass: every enabled user, or only `users`. */
  async pass(gen, users) {
    let accounts;
    let calendars;
    try {
      accounts = await this.gladys.getCalendarAccounts();
      this.alive(gen);
      calendars =
        users?.size === 1
          ? await this.gladys.getCalendars([...users][0])
          : await this.gladys.getCalendars();
      this.alive(gen);
    } catch (err) {
      if (err instanceof Stopped) throw err;
      this.gladysFailed(gen, err, users);
      return;
    }
    this.gladysRetry = 0;
    if (!Array.isArray(accounts)) accounts = [];
    if (!Array.isArray(calendars)) calendars = [];
    const enabled = new Set();
    for (const account of accounts.slice(0, MAX_USERS)) {
      const selector = account?.user?.selector;
      if (typeof selector !== 'string' || !USER_SELECTOR.test(selector)) continue;
      enabled.add(selector);
      if (users && !users.has(selector)) continue;
      const own = calendars.filter((c) => c?.user === selector);
      try {
        await this.syncUser(gen, account, own);
      } catch (err) {
        if (!err?.gladysDown) throw err;
        this.gladysFailed(gen, err.cause, users);
        return;
      }
    }
    // Users who disabled the integration: Gladys destroyed their calendars.
    for (const selector of [...this.problems.keys()]) {
      if (!enabled.has(selector)) this.problems.delete(selector);
    }
    for (const selector of [...this.calendarCount.keys()]) {
      if (!enabled.has(selector)) this.calendarCount.delete(selector);
    }
    // Beyond MAX_USERS enabled users, the others are not synced: said.
    this.overUsers = accounts.length > MAX_USERS ? accounts.length - MAX_USERS : 0;
    this.publishStatus(enabled.size);
  }

  // ---------------------------------------------------------------- one user

  async syncUser(gen, account, existing) {
    const user = account.user;
    const config = account.config && typeof account.config === 'object' ? account.config : {};
    const problems = [];
    this.problems.set(user.selector, problems);
    const country = typeof config.country === 'string' ? config.country : '';
    if (!COUNTRY_CODES.has(country)) {
      problems.push({ key: 'problemCountry', values: { user: user.selector } });
      return;
    }
    const { en, fr } = countryOf(country);
    const countryName = { en, fr };
    const split = splitRegions(config.regions);
    if (split.error) {
      problems.push({ key: 'problemRegionsTooMany', values: { user: user.selector } });
      return;
    }
    const catalog = await this.catalog(country);
    this.alive(gen);
    if (!catalog) {
      problems.push({
        key: 'problemNoData',
        values: { user: user.selector, country: countryName },
      });
      return;
    }
    const regions = [];
    if (split.entries.length === 0) {
      if (catalog.some((r) => r.top || r.group)) {
        problems.push({
          key: 'problemRegionRequired',
          values: { user: user.selector, country: countryName },
        });
        return;
      }
      regions.push({ country, code: country, whole: true });
    }
    for (const entry of split.entries) {
      const found = resolveRegion(country, catalog, entry);
      if (found.region) {
        const r = found.region;
        if (!regions.some((x) => x.code === r.code)) {
          regions.push({ country, code: r.code, names: r.names, group: r.group });
        }
      } else if (found.error === 'ambiguous') {
        problems.push({
          key: 'problemRegionAmbiguous',
          values: {
            user: user.selector,
            entry: entry.slice(0, 40),
            codes: found.matches.map((m) => m.code).join(', '),
          },
        });
      } else {
        problems.push({
          key: 'problemRegionUnknown',
          values: { user: user.selector, entry: entry.slice(0, 40), country: countryName },
        });
      }
    }
    // One entry not understood: nothing changes for this user (their
    // calendars stay as they are until the field is corrected).
    if (problems.length > 0) return;

    const { fromDate, toDate, window } = windowAt(this.now());
    const wanted = regions.map((region) => ({
      region,
      calendar: buildCalendar(this.gladys, user, region),
    }));
    this.calendarCount.set(user.selector, wanted.length);
    const calendarsKey = `user:${user.selector}`;
    const calendarsBody = JSON.stringify(wanted.map((w) => w.calendar));
    if (this.sent.get(calendarsKey) !== calendarsBody) {
      const ok = await this.write(gen, user, '', () =>
        this.gladys.publishCalendars(
          user.selector,
          wanted.map((w) => w.calendar),
        ),
      );
      if (ok === 'gone') return;
      if (ok === true) this.sent.set(calendarsKey, calendarsBody);
      else return;
    }
    // The calendars of this integration no longer wanted (country or regions changed).
    const wantedIds = new Set(wanted.map((w) => w.calendar.external_id));
    for (const old of existing) {
      if (typeof old?.external_id !== 'string' || wantedIds.has(old.external_id)) continue;
      const ok = await this.write(gen, user, '', () => this.gladys.deleteCalendar(old.external_id));
      if (ok === 'gone') return;
    }
    for (const { region, calendar } of wanted) {
      const stored = existing.find((c) => c?.external_id === calendar.external_id);
      if (stored && stored.sync === false) continue; // the user said no
      const entry = await this.holidays(region, fromDate, toDate);
      this.alive(gen);
      const name = regionName(region, user);
      if (this.tooMany.has(`holidays:${region.country}|${region.code}`)) {
        problems.push({
          // The events of an earlier read stay published: not updated.
          key: entry ? 'problemTooManyKept' : 'problemTooMany',
          values: { user: user.selector, region: name },
        });
      }
      if (entry?.empties) {
        problems.push({ key: 'problemEmpty', values: { user: user.selector, region: name } });
      }
      // Never read: nothing is published (an empty window would prune nothing
      // useful, but a later read fills it).
      if (!entry) continue;
      const events = buildEvents(this.gladys, user, region, entry.items, fromDate, toDate, catalog);
      const key = `${user.selector}:${calendar.external_id}`;
      const body = JSON.stringify({ window, events });
      if (this.sent.get(key) === body) continue;
      const ok = await this.write(gen, user, name, () =>
        this.gladys.publishCalendarEvents(calendar.external_id, events, window),
      );
      if (ok === 'gone') return;
      if (ok === true) this.sent.set(key, body);
    }
  }

  /**
   * One calendar write, within 25 a minute: true when done, 'gone' when the
   * user disabled the integration meanwhile (404), false otherwise (403: the
   * calendar is not synced; 400: refused, reported). A 429 waits a minute and
   * tries once more. Gladys unreachable stops the pass (retried later).
   */
  async write(gen, user, name, fn) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await this.slot(gen);
      try {
        await fn();
        return true;
      } catch (err) {
        this.alive(gen);
        const status = err?.status;
        if (status === 404) return 'gone';
        if (status === 403) return false;
        if (status === 429 && attempt === 0) {
          await this.sleep(gen, GLADYS_429_WAIT);
          continue;
        }
        if (Number.isInteger(status) && status >= 400 && status < 500) {
          this.problems.get(user.selector)?.push({
            key: 'problemRefused',
            values: { user: user.selector, region: name || '-', reason: reasonOf(err) },
          });
          this.logger.warn?.(`Gladys refused a calendar write (${reasonOf(err)})`);
          return false;
        }
        const down = new Error('gladys down');
        down.gladysDown = true;
        down.cause = err;
        throw down;
      }
    }
    return false;
  }

  /** Waits for a write slot: 25 writes within any minute (monotonic clock). */
  async slot(gen) {
    for (;;) {
      this.alive(gen);
      const now = this.mono();
      this.writes = this.writes.filter((at) => now - at < WRITE_WINDOW);
      if (this.writes.length < WRITES_PER_MINUTE) {
        this.writes.push(now);
        return;
      }
      await this.sleep(gen, WRITE_WINDOW - (now - this.writes[0]) + 10);
    }
  }

  sleep(gen, ms) {
    return new Promise((resolve) => {
      const id = this.timers.setTimeout(resolve, Math.max(0, ms));
      // stop() cuts the wait: the pass then ends on alive().
      this.sleeping = { id, resolve };
    }).then(() => {
      this.sleeping = null;
      this.alive(gen);
    });
  }

  // ---------------------------------------------------------------- status

  setStatus(connected, message) {
    const key = JSON.stringify([connected, message]);
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    this.gladys.setConnectionStatus(connected, message).catch((err) => {
      this.lastStatus = '';
      this.logger.warn?.(`Status not published (${reasonOf(err)})`);
    });
  }

  publishStatus(users) {
    if (this.paused()) {
      const minutes = Math.max(1, Math.ceil((this.pause.until - this.mono()) / MINUTE));
      this.setStatus(false, both('statusPaused', { reason: this.pause.reason, minutes }));
      return;
    }
    const all = [...this.problems.values()].flat();
    if (this.overUsers)
      all.unshift({ key: 'problemUsers', values: { max: MAX_USERS, more: this.overUsers } });
    const calendars = [...this.calendarCount.values()].reduce((a, b) => a + b, 0);
    const ok = both('statusOk', { users, calendars });
    if (all.length === 0) {
      this.setStatus(true, ok);
      return;
    }
    const list = problemsText(all);
    this.setStatus(true, {
      en: `${ok.en} ${list.en}`.slice(0, 1000),
      fr: `${ok.fr} ${list.fr}`.slice(0, 1000),
    });
  }

  // ---------------------------------------------------------------- action

  /** The "List the regions" button: the regions of a country, from the API (cached a week). */
  async listRegions(fields) {
    const country = typeof fields?.country === 'string' ? fields.country : '';
    if (!COUNTRY_CODES.has(country)) return both('countryUnknown');
    const name = countryOf(country);
    let catalog;
    try {
      catalog = await this.catalog(country);
    } catch (err) {
      return both('regionsUnavailable', { country: name.en, reason: reasonOf(err) });
    }
    if (!catalog) {
      return {
        en: t('regionsUnavailable', 'en', {
          country: name.en,
          reason: this.pause.reason || 'no data',
        }),
        fr: t('regionsUnavailable', 'fr', {
          country: name.fr,
          reason: this.pause.reason || 'pas de données',
        }),
      };
    }
    const shown = catalog.filter((r) => r.top || r.group);
    if (shown.length === 0) {
      return {
        en: t('regionsNone', 'en', { country: name.en }),
        fr: t('regionsNone', 'fr', { country: name.fr }),
      };
    }
    const list = (lang) => {
      let out = '';
      for (const [i, r] of shown.entries()) {
        const item = `${r.code} – ${pick(r.names, lang)}`;
        if (out.length + item.length > 1500) return `${out}, … (+${shown.length - i})`;
        out += (out ? ', ' : '') + item;
      }
      return out;
    };
    return {
      en: t('regionsList', 'en', { country: name.en, list: list('EN') }),
      fr: t('regionsList', 'fr', { country: name.fr, list: list('FR') }),
    };
  }
}

export { ACTIONS };
