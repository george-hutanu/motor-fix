# Deferred findings — 018-one-language

- [ ] The one-language e2e check skips translation texts with a placeholder (`{count}`, `{name}`), so a parametrised Romanian text shown under English is not caught; compare the literal part before the first placeholder instead. Source: spec-reviewer, LOW. `apps/web-e2e/src/one-language.spec.ts` (the `.filter((text) => !text.includes('{'))` line). — Notion: https://app.notion.com/p/3ef607bff0d281b78524fcd37c20070d
