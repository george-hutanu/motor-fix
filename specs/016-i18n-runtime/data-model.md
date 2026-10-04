# Data model: 016-i18n-runtime

No persisted data. The runtime holds:

- **Language** — `'ro' | 'en'`, from `LANGUAGES` (one constant). Current
  language: a signal, initially `'ro'`. Setting a value outside `LANGUAGES` is
  ignored.
- **Area** — `'shell' | 'public' | 'driver' | 'garage' | 'mechanic' | 'admin'`,
  from `AREAS`. `shell` is entered at start; others when a route enters them.
- **Translation file** — `libs/i18n/src/<area>/<lang>.json`: nested JSON
  objects whose leaves are non-empty strings. Keys are English camelCase
  segments grouped by screen. At load, leaves are flattened to dotted keys
  prefixed with the area: `shell/ro.json` `{ "brand": "MotorFix" }` →
  `shell.brand`.
- **Plural group** — an object whose keys are exactly the plural categories of
  its language (`ro`: one, few, other; `en`: one, other); selected with a
  `count` parameter.
- **Placeholders** — `{name}` inside a text, replaced by the parameter of the
  same name; `{count}` in plural texts.
- **Texts per language** — `Record<dottedKey, string>`, one per language,
  merged as files load. Lookup order: current language, then Romanian.

State of a file: not loaded → loaded; a failed load stays "not loaded" and is
tried again the next time its area is entered or its language set.
