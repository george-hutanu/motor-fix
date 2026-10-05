# Deferred — 132-sign-up-consent

- [ ] `apps/web/src/app/public/legal-texts.ts` — **low** — the two interface labels of the legal pages (`LEGAL_LABELS`: draft note, "Version") sit outside the i18n files; move them to `public.legal.*` when the final texts land (code-reviewer #3, 2026-10-05) — Notion: https://app.notion.com/p/3f0607bff0d2813e8c7efffabfdb521f
- [ ] `libs/domain/src/auth/consent.ts` — **low** — `consentRequired()` hand-builds the refusal shape that `refusal()` in `sign-up.service.ts` already produces, and `type Consent` repeats `ConsentDto`; reuse both when the second sign-up method lands (code-reviewer #4, #5, 2026-10-05) — Notion: https://app.notion.com/p/3f0607bff0d281d1acbafe342dbab05d
- [ ] `libs/domain/src/auth/accounts.service.ts:14` — **low** — pre-existing: `export interface NewAccount` is imported nowhere outside its file (code-reviewer #6, 2026-10-05) — Notion: https://app.notion.com/p/3f0607bff0d281728390fa0606c1f377
