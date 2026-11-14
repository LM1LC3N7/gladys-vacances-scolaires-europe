# TODO

## Before announcing

- [ ] Review r1 (high: open data, no account, nothing commanded).
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic at publication only.
- [ ] Store field not set in the manifest: `keywords` (Schulferien, Ferien,
      vacances scolaires, schoolvakanties, ferie, OpenHolidays).

## To watch

- [ ] Coverage depends on the API: no 2026-2027 school year yet for Spain,
      Italy, Bulgaria, Croatia, Hungary, Ireland, Latvia, Malta, Romania,
      Serbia, Slovenia, San Marino (checked 2026-11-14): calendars stay empty
      until the API publishes.
- [ ] No published rate limit for the API: one read a day per region, one a
      week per country list. Watch for a 429 in the logs.
- [ ] Scenes (`calendar.is-event-running`, `calendar.event-is-coming`) not
      tried in the sandbox: they read shared calendars like CalDAV ones.

## Decisions

- Version 0.1.0 set by hand (package.json, lock, manifest, docker_image).
- `gladys_version: ">=5.3.0"`: `countries` (Louis, 2026-11-12) needs 5.3.0;
  the calendar type 5.2.0.
- `countries`: 20 of the 30 countries offered (the manifest limit), the
  closest to the Gladys community and with regions; the other 10 are offered
  in the list and found by the search.
- Type `calendar`, per user (`account_schema`): enabling is the consent, the
  user shares the calendar for scenes. No device: "on holiday today" is the
  scene condition "an event is running".
- Regions as free text (code, ISO code, name), not a select: the lists come
  from the API (nothing embedded), CH alone has 2,000 entries; the "List the
  regions" action shows the codes.
- One calendar per region (3 at most per user): two children in two Länder.
- Window from the 1st of the month, 13 months; bounds at noon UTC so that
  the published events always overlap and the past is never pruned (no
  timezone to know: the core stores full days at its own midnights).
- Names in the user's language when the API has it, else the local one
  (Weihnachtsferien, Bayern), never guessed.
- France excluded (gladys-holidays covers it).
