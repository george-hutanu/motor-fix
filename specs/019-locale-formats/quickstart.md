# Quickstart: 019-locale-formats

1. `npx jest -c libs/i18n/jest.config.cts libs/i18n/src/formats.spec.ts libs/i18n/src/format.pipes.spec.ts`
   — every example of [contracts/formats.md](./contracts/formats.md) in both languages, a process in America/New_York still printing Bucharest time, and a rendered host switching from "1.400 lei · 4,9 · 9 mart. 2026" to "1,400 lei · 4.9 · 9 Mar 2026" without being recreated.
2. `npx nx run i18n:typecheck` and `npx biome check libs/i18n` — clean.
3. In a screen: import `LeiPipe, RatingPipe, DayPipe` from `@motor-fix/i18n` and write `{{ price | lei }}`; switching the language with `I18n.use('en')` changes it in place.
