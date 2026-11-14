# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- School holidays of a region (Land, canton, community, region) in 30
  European countries outside France, from the OpenHolidays API: one calendar
  per region for every user who enables the integration in "My calendars",
  13 months ahead, read once a day.
- Regions given by code, ISO code or name, up to 3 per user; "List the
  regions" action.
- Catalog countries (`countries`, Gladys 5.3.0): the 14 countries with
  published school holidays, then 6 EU members waiting for theirs.
- Region codes with non-ASCII letters (Kärnten AT-KÄ, Lower and Upper
  Austria, Swiss districts); the school types an event is for in its
  description.

[Unreleased]: https://github.com/LM1LC3N7/gladys-vacances-scolaires-europe/commits/main
