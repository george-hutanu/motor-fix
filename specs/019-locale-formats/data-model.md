# Data model: 019-locale-formats

Nothing is stored. The values the formats accept:

| Value | Type | Valid when | Otherwise |
| --- | --- | --- | --- |
| Amount | `number`, whole bani | finite; rounded to the nearest ban | "—" |
| Rating, number, distance (km), percentage | `number` | finite | "—" |
| Instant | `Date` \| ISO-8601 string \| epoch ms | gives a valid `Date` | "—" |
| Language | `'ro' \| 'en'` (`libs/i18n/src/languages.ts`) | — | — |

Calendar names (per language): `firstDay: 1`; `months` (12 full), `monthsShort` (12, fixed table), `days` and `daysShort` (7, Monday first).
