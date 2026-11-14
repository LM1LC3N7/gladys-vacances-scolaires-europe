# TODO

## Before announcing

- [ ] Review r1 (high: open data, no account, nothing commanded).
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic at publication only.
- [ ] Store field not set in the manifest: `keywords` (Schulferien, Ferien,
      vacances scolaires, schoolvakanties, ferie, OpenHolidays).

## To watch

- [ ] Coverage depends on the API: no 2026-2027 school year yet (checked
      2026-11-14, window 2026-11-01..2027-12-01) for AL, BG, BY, ES, HR, HU,
      IE, IT, LV, MC, MD, MT, RO, RS, SI, SM: calendars stay empty until the
      API publishes. Re-check `countries` at each release (rule below).
- [ ] Timezones beyond UTC+11 (Auckland in summer, Fiji, Tonga, Samoa,
      Kiritimati): a holiday ending on the 1st of the month gives a 400
      ("must overlap") with the noon-UTC window. Out of the European scope,
      said in the docs.
- [ ] An empty answer after holidays is kept twice (the API answers `[]` to
      unknown codes): a region whose holidays really vanish keeps them two
      more days.
- [ ] No published rate limit for the API: one read a day per region, one a
      week per country list. Watch for a 429 in the logs.
- [ ] Scenes (`calendar.is-event-running`, `calendar.event-is-coming`) not
      tried in the sandbox: they read shared calendars like CalDAV ones.

## Decisions

- Version 0.1.0 set by hand (package.json, lock, manifest, docker_image).
- `gladys_version: ">=5.3.0"`: `countries` (Louis, 2026-11-12) needs 5.3.0;
  the calendar type 5.2.0.
- `countries` (20 at most): first every country with school holidays of the
  current window in the API (14 on 2026-11-14: AD AT BE CH CZ DE EE LI LT
  LU NL PL PT SK), then the most populous EU members whose earlier school
  years are in the API but not the current one yet (IT ES RO HU BG IE).
  Left out but offered and found by the search: AL BY HR LV MC MD MT RS SI
  SM. France excluded (gladys-holidays); an instance in France sees this
  integration through the search only.
- Type `calendar`, per user (`account_schema`): enabling is the consent, the
  user shares the calendar for scenes. No device: "on holiday today" is the
  scene condition "an event is running".
- Regions as free text (code, ISO code, name), not a select: the lists come
  from the API (nothing embedded), CH alone has 2,000 entries; the "List the
  regions" action shows the codes.
- One calendar per region (3 at most per user): two children in two Länder.
- Region codes may hold non-ASCII capitals (AT-KÄ, CH-BE-SL-RÜ): kept as
  the API writes them in ids and requests (NFC; the core takes any string).
- Read once a day whatever the window: at the turn of a month the holidays
  read hours before still serve.
- Window from the 1st of the month, 13 months; bounds at noon UTC so that
  the published events always overlap and the past is never pruned (no
  timezone to know: the core stores full days at its own midnights).
- Names in the user's language when the API has it, else the local one
  (Weihnachtsferien, Bayern), never guessed.
- France excluded (gladys-holidays covers it).
