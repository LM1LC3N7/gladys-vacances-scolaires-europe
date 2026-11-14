# gladys-vacances-scolaires-europe

Unofficial [Gladys Assistant](https://gladysassistant.com) integration: the
**school holidays of a region** (German Land, Austrian Bundesland, Swiss
canton, Belgian community, Dutch region…) in 30 European countries, France
excluded (see gladys-holidays), as **calendars**. Each user enables it in
"My calendars", chooses a country and up to 3 regions, and gets one calendar
per region, 13 months ahead, usable in scenes once shared.

- Documentation: [English](docs/en.md), [français](docs/fr.md).
- Data: [OpenHolidays API](https://www.openholidaysapi.org), public, no key.
  Contains information from the OpenHolidays API, made available under the
  Open Database License (ODbL-1.0). See
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Requires Gladys 5.3.0 or later (calendar integrations, catalog countries).

## Development

```bash
npm install
npm test                          # node --test (or gi test)
npm run lint
npm run format:check
memcap node scripts/mutants.mjs   # mutation check
```

The release (version, image, GitHub Release) is made by the Release workflow
of the template. Licensed under the Apache License 2.0.
