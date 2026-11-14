# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains no code taken from another project: the client is written for it
from the public description of the OpenHolidays API (its OpenAPI document).
The server of the API (openpotato/openholidaysapi, AGPL-3.0) was not read
for code, nor copied or ported: the integration only calls the public API.

## OpenHolidays API data

The school holidays and the lists of regions are read at run time from the
OpenHolidays API (<https://www.openholidaysapi.org>). Nothing of the data is
shipped in the image.

Contains information from the OpenHolidays API, which is made available here
under the Open Database License (ODbL-1.0):
<https://github.com/openpotato/openholidaysapi.data/blob/main/LICENSE>.

The test fixtures (`test/fixtures/*.json`, not part of the image) are answers
of the API recorded on 2026-11-14, unchanged (`subdivisions-CH-BE.json`:
the canton of Bern only, cut out of the Swiss answer), under the same
licence.

Changes made to the data when it is shown in Gladys: the last day of a
holiday becomes an exclusive end (the day after), the name is taken in the
user's language when the API has it, the back-to-school and end-of-lessons
days are left out.
