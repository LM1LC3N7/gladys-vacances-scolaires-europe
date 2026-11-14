# School holidays Europe

Unofficial integration. It adds the **school holidays of your region** in
several European countries (France excluded) to Gladys: German Land,
Austrian Bundesland, Swiss canton, Belgian community, Dutch region, Polish
voivodeship… as a **calendar**. The data comes from the **OpenHolidays API**
(<https://www.openholidaysapi.org>), public, no account, no key.

France is not offered: its school holidays (zones A, B, C) are in the
**gladys-holidays** integration.

It was tried with the real OpenHolidays API and a test Gladys 5.3 (calendar
filled, scenes not tried); please report any wrong date.

## Setup

1. Install the integration (Gladys 5.3.0 or later). Nothing to fill in on
   its configuration screen.
2. Every user who wants it opens the integration page, **"My calendars"**
   block, and enables it:
   - **Country**: from the list.
   - **Regions** (up to 3, separated by commas): the code (`DE-BY`, `AT-WI` or `AT-9`,
     `CH-ZH`, `BE-FR`), the code without the country (`BY`) or the name in a
     language of the API (`Bayern`, `Bavaria`, `Zürich`). Accents and case
     do not matter. Leave it empty for a country without regions
     (Luxembourg, Estonia, Lithuania, Andorra, Liechtenstein…).
3. A **"School holidays – <region>"** calendar appears for each region,
   filled with the holidays from the 1st of the current month to 13 months
   later.

A name matching several regions, or an unknown region, changes nothing to
the calendars already there: the integration status (seen by the
administrator) says what to fix. The **"List the regions"** button
(configuration screen, administrator) gives the codes and names of a
country.

Depending on the country, the API also knows groups: Belgian communities
(`BE-FR`, `BE-NL`, `BE-DE`), Dutch regions (`NL-NO`, `NL-MI`, `NL-ZU`),
school types in Mecklenburg (`DE-MV-ABS`, `DE-MV-BBS`), Swiss school
regions. A region also gets the national holidays and those of the region
above it (a town inherits its canton's).

## Scenes: "on holiday today"

A pushed calendar is **private** at first. To use it in scenes, share it
(**Shared** toggle in "My calendars"): the whole household then sees it and
the scenes read it, for example:

- trigger **"A calendar event is coming"** (the day before school starts
  again, the first day of the holidays);
- condition **"An event is running"** on that calendar: true on a holiday
  (to skip the children's alarm).

There is no device: the calendar is enough.

## What the integration does

- **Reads**: once a day at most per region (once a week for the lists of
  regions), however many restarts or clicks. The date of the data and of the
  last attempt are kept in `/data`.
- **An empty answer** for a region that had holidays: the holidays read
  before are kept (and said in the status) until the third empty answer in a
  row, a day apart (the API answers "nothing" to what it does not know).
- **Unreadable answer** (maintenance page, not a list, cut): treated as an
  outage, paused like below. More than 500 holidays for a region: refused and
  said in the status.
- **API down**: every request is paused 60 s, then 2 min, 4 min… up to 6 h,
  honouring the `Retry-After` header; the holidays already read stay in the
  calendar. Answers are limited to 1 MB (2 MB for the lists of regions) and
  20 s.
- **Writes to Gladys**: 25 a minute at most (Gladys accepts 30); nothing is
  resent when nothing changed. 200 users at most (beyond, said in the
  status).
- **The past is kept**: only the current window (from the 1st of the month,
  13 months) is replaced; past holidays stay in the calendar.
- **Calendar not synced** (**Sync** toggle off): it receives nothing more;
  turned back on, it is filled again.
- The "back to school" and "end of lessons" days of the API are not
  holidays: they are left out. A half day is noted in the event description.
  A holiday given once per school type (Zürich: `CH-ZH-VS` Volksschulen,
  `CH-ZH-MS` Mittelschulen…) with the same dates shows once; for
  the dates of one school type only, give its group code. The description
  of an event names the school types it is for: two events of the same name
  that overlap (Mecklenburg: "Sommerferien" for ABS and for BBS) are two
  school types, and the scene condition "an event is running" is true on
  both.
- Holidays are full-day events, stored at the midnights of the Gladys
  timezone (timezones from UTC-11 to UTC+11).

## Countries

Offered: Albania, Andorra, Austria, Belarus, Belgium, Bulgaria, Croatia,
Czechia, Estonia, Germany, Hungary, Ireland, Italy, Latvia, Liechtenstein,
Lithuania, Luxembourg, Malta, Moldova, Monaco, Netherlands, Poland,
Portugal, Romania, San Marino, Serbia, Slovakia, Slovenia, Spain,
Switzerland.

The Gladys catalog lists an integration in 20 countries at most: here the 14
whose school holidays 2026-2027 are in the API (Andorra, Austria, Belgium,
Czechia, Estonia, Germany, Liechtenstein, Lithuania, Luxembourg, the
Netherlands, Poland, Portugal, Slovakia, Switzerland), then the 6 most
populous EU members still waiting for theirs (Italy, Spain, Romania,
Hungary, Bulgaria, Ireland). The other 10 (Albania, Belarus, Croatia,
Latvia, Malta, Moldova, Monaco, San Marino, Serbia, Slovenia) are offered
all the same: the catalog search finds the integration from any country.

Coverage depends on the API: some countries publish their school year late
(on 14 November 2026, nothing yet for 2026-2027 in Albania, Belarus,
Bulgaria, Croatia, Hungary, Ireland, Italy, Latvia, Malta, Moldova, Monaco,
Romania, San Marino, Serbia, Slovenia and Spain). An empty calendar fills as
soon as the API has the dates.

## Data and licence

Contains information from the OpenHolidays API
(<https://www.openholidaysapi.org>), made available under the Open Database
License (ODbL-1.0,
<https://github.com/openpotato/openholidaysapi.data/blob/main/LICENSE>).
The integration calls the API and embeds none of its data; the API server
(AGPL-3.0) is neither copied nor ported. Every calendar and every event
cites the source. The integration itself is licensed under Apache-2.0.
