// -----------------------------------------------------------------------------
// Runtime texts, English and French (same placeholders in both).
// -----------------------------------------------------------------------------

export const TEXTS = {
  calendarName: { en: 'School holidays – {region}', fr: 'Vacances scolaires – {region}' },
  calendarDescription: {
    en: 'School holidays of {region} ({country}), from the OpenHolidays API (openholidaysapi.org), data under the Open Database License (ODbL-1.0).',
    fr: 'Vacances scolaires de {region} ({country}), d’après l’API OpenHolidays (openholidaysapi.org), données sous licence Open Database License (ODbL-1.0).',
  },
  eventSource: {
    en: 'Source: OpenHolidays API (openholidaysapi.org), ODbL-1.0.',
    fr: 'Source : API OpenHolidays (openholidaysapi.org), ODbL-1.0.',
  },
  halfDay: { en: 'Half day.', fr: 'Demi-journée.' },
  wholeCountry: { en: 'whole country', fr: 'tout le pays' },
  statusOk: {
    en: '{users} user(s), {calendars} calendar(s) up to date.',
    fr: '{users} utilisateur(s), {calendars} calendrier(s) à jour.',
  },
  statusPaused: {
    en: 'OpenHolidays unreachable ({reason}): next try in {minutes} min, the holidays already read are kept.',
    fr: 'OpenHolidays injoignable ({reason}) : nouvel essai dans {minutes} min, les vacances déjà lues sont gardées.',
  },
  statusGladys: {
    en: 'Gladys did not give the accounts ({reason}): next try in {seconds} s.',
    fr: 'Gladys n’a pas donné les comptes ({reason}) : nouvel essai dans {seconds} s.',
  },
  problemCountry: {
    en: 'user {user}: no country chosen (or not offered)',
    fr: 'utilisateur {user} : aucun pays choisi (ou pays non proposé)',
  },
  problemRegionRequired: {
    en: 'user {user}: {country} has school holidays by region, a region is needed',
    fr: 'utilisateur {user} : {country} a des vacances par région, une région est nécessaire',
  },
  problemRegionUnknown: {
    en: 'user {user}: region "{entry}" unknown in {country}',
    fr: 'utilisateur {user} : région « {entry} » inconnue en {country}',
  },
  problemRegionAmbiguous: {
    en: 'user {user}: "{entry}" matches several regions ({codes}), give the code',
    fr: 'utilisateur {user} : « {entry} » désigne plusieurs régions ({codes}), indiquez le code',
  },
  problemRegionsTooMany: {
    en: 'user {user}: 3 regions at most, 200 characters at most',
    fr: 'utilisateur {user} : 3 régions au plus, 200 caractères au plus',
  },
  problemNoData: {
    en: 'user {user}: the regions of {country} could not be read yet',
    fr: 'utilisateur {user} : les régions de {country} n’ont pas encore pu être lues',
  },
  problemTooMany: {
    en: 'user {user}: too many holidays for {region}, not published',
    fr: 'utilisateur {user} : trop de vacances pour {region}, rien publié',
  },
  problemRefused: {
    en: 'user {user}: Gladys refused the calendar {region} ({reason})',
    fr: 'utilisateur {user} : Gladys a refusé le calendrier {region} ({reason})',
  },
  regionsList: {
    en: 'Regions of {country} (code – name): {list}',
    fr: 'Régions de {country} (code – nom) : {list}',
  },
  regionsNone: {
    en: '{country} has no region in OpenHolidays: leave "Regions" empty.',
    fr: '{country} n’a pas de région dans OpenHolidays : laissez « Régions » vide.',
  },
  regionsUnavailable: {
    en: 'The regions of {country} could not be read ({reason}).',
    fr: 'Les régions de {country} n’ont pas pu être lues ({reason}).',
  },
  countryUnknown: {
    en: 'Choose one of the countries offered.',
    fr: 'Choisissez un des pays proposés.',
  },
};

/**
 * The text `key` in `lang` ('fr' or English), placeholders filled; a value
 * given as `{ en, fr }` is taken in that language.
 */
export function t(key, lang, values = {}) {
  const entry = TEXTS[key];
  const l = lang === 'fr' ? 'fr' : 'en';
  return entry[l].replace(/\{(\w+)\}/g, (m, name) => {
    if (!(name in values)) return m;
    const v = values[name];
    return String(v && typeof v === 'object' ? v[l] : v);
  });
}

/** `{ en, fr }` of the text `key`. */
export function both(key, values) {
  return { en: t(key, 'en', values), fr: t(key, 'fr', values) };
}
