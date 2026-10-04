# Contract: `@motor-fix/i18n` formats

Pure functions (no Angular dependency; usable on the server), named after their pipes so they never clash with `formatNumber` / `formatDate` from `@angular/common`:

| Function | Example (ro / en) |
| --- | --- |
| `formatLei(bani, language)` | 140000 → "1.400 lei" / "1,400 lei"; 140050 → "1.400,50 lei" / "1,400.50 lei" |
| `formatLeiRange(from, to, language)` | 80000, 120000 → "800–1.200 lei" / "800–1,200 lei" |
| `formatRating(value, language)` | 4.9 → "4,9" / "4.9" |
| `formatNum(value, language)` | 12345.6 → "12.345,6" / "12,345.6" |
| `formatKm(km, language)` | 2.5 → "2,5 km" / "2.5 km" |
| `formatPct(value, language)` | 92 → "92%" |
| `formatDay(instant, language)` | 2026-03-09 → "9 mart. 2026" / "9 Mar 2026" |
| `formatClock(instant)` | 12:30Z in March → "14:30" |
| `calendarNames(language)` | `{ firstDay: 1, months, monthsShort, days, daysShort }` |

Every function returns "—" for a missing or invalid value.

Template pipes (standalone, impure, follow `I18n.language()`):

| Pipe | Use |
| --- | --- |
| `lei` | `{{ bani \| lei }}`, `{{ from \| lei: to }}` |
| `rating` | `{{ 4.9 \| rating }}` |
| `num` | `{{ n \| num }}` |
| `km` | `{{ 2.5 \| km }}` |
| `pct` | `{{ 92 \| pct }}` |
| `day` | `{{ instant \| day }}` |
| `clock` | `{{ instant \| clock }}` |
