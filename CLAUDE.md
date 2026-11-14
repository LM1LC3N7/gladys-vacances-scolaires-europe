# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors.

## What this is

A Gladys Assistant **external integration** of type `calendar` (Node.js 22+,
ESM, no build step, sandboxed Docker container, `@gladysassistant/integration-sdk`
0.16). For every user who enabled it ("My calendars": a country, up to 3
regions), one calendar per region filled with the school holidays read from
the public OpenHolidays API (data ODbL-1.0). Europe outside France.
Unofficial. No device, nothing commanded.

## Commands

```bash
npm install
npm test                                  # node --test (or gi test)
npm run lint && npm run format:check
memcap node scripts/mutants.mjs           # mutation check, one mutant at a time
```

## Architecture

```
index.js             SDK wiring only (src/handlers.js)
src/app.js           HolidaysApp: queue of passes, users, calendars, writes within
                     25/min, API reads (TTL, attempt, pause), /data, status, action
src/openholidays.js  API client and checks of its answers (pure parsing)
src/regions.js       what the user typed -> regions (code, ISO code, name)
src/events.js        calendars and events sent to Gladys (ids, names, texts)
src/time.js          calendar dates, the published window (noon UTC bounds)
src/http.js          the only network access (User-Agent, bounds, deadline)
src/store.js         /data/state.json
src/i18n.js          runtime texts (en/fr)
```

## Rules

- **Ids are forever**: calendar `ext:<selector>:<user>:<region code>`, event
  `ext:<selector>:<user>:<region code>:<API holiday id>`; manifest keys
  (`country`, `regions`, `list_regions`) and country codes.
- **Once a day per region, once a week per country list**, whatever the
  restarts or clicks (date of the data and of the attempt in /data); a failure
  pauses every request (60 s doubled, 6 h max, Retry-After), persisted.
- **25 calendar writes a minute** at most (Gladys: 30); identical content is
  not resent; a reconnection or an account change resends.
- **Never guess a region**: unknown or ambiguous = reported, nothing changed.
  Codes may hold non-ASCII capitals (AT-KÄ, CH-BE-SL-RÜ): never restrict them
  to ASCII.
- **Answers**: unreadable = outage (pause); more than 500 holidays = refused
  and said; an empty answer after holidays is kept twice (said) before being
  believed; identical holidays per school type are one event naming them.
- **The window**: 1st of the month to 13 months later, bounds at noon UTC (see
  src/time.js): never a 400, the past never pruned, timezones UTC-11..+11.
- **Data**: the API is called, nothing of it is embedded (test fixtures
  aside); ODbL attribution in docs, notices, calendars and events. The API
  server is AGPL-3.0: never read for code, never copied or ported.
- France stays with gladys-holidays: never add FR.
- Bilingual texts (en/fr), CHANGELOG `[Unreleased]`, versions by the Release
  workflow only.
