# Feature Context: Translation files and runtime language switching

- **Feature**: 016-i18n-runtime
- **Anchor**: ST-16 Set up translation files and runtime language switching — https://app.notion.com/p/3ee607bff0d281c3927ec1b8e980be00 | terms: translation, language, Romanian, English, Transloco
- **Gathered**: 2026-10-04
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic ok | architecture ok (Technology stack, Architecture decisions) | decisions partial (Open decisions page overflows fetch; only search excerpts read)
- **Overall confidence**: high

## Story

- **ST-16 Set up translation files and runtime language switching** — status In progress, priority Highest, role System, issue type Task, 3 points, label front end, epic EP-1 Foundations, feature MF-1 "Romanian and English interface". Page edited 2026-10-04T05:24Z.
- Scope per the story: "one translation file per language and a way to change language while the app runs". Acceptance: Romanian and English files with the same keys; every interface text from the files, none written in a screen; language changes at run time with no reload; "A text missing in English shows the Romanian text, never an empty space". Build brief (it "wins" over the page above it): `libs/i18n` of `apps/web`, one ro/en file per area (shell, public, driver, garage, mechanic, admin) loaded with the area, Romanian default and fallback, switch without reload, build checks.
- Out of scope per the brief: the RO / EN control and remembering the choice (ST-17); formats (ST-19); account language; web addresses per language (ST-21); notification templates.
- Comments that moved scope: none (story and feature page carry no comments).

## Decisions

- Library: Transloco, "with one lazy-loaded file per language and area" — marked **Proposed**, so the plan must confirm it; Angular build-time i18n is rejected because it cannot switch without a reload. [Technology stack, Front end > Two languages; ST-16 Build brief, Rules] (2026-10-03 19:05 / 2026-10-04, confidence: high)
- Romanian is default and fallback; `LANGUAGES` is one constant (`ro`, `en`) so a third language is "a new file, not new code". [ST-16 Build brief; feature Build brief rule 1, rule 9] (2026-10-04, confidence: high)
- Keys are English, dotted, grouped by area and screen (`auth.signIn.title`); counts use ICU plural rules ("1 service", "3 service-uri", "48 de service-uri"); "Sentences are never glued together from pieces"; Romanian uses ș and ț (comma below). All marked *(proposed)*. [ST-16 Build brief, Rules] (2026-10-04, confidence: medium)
- A file that fails to load: the area shows its Romanian texts "from the build" and retries on the next navigation *(proposed)*. [ST-16 Build brief, States and errors] (2026-10-04, confidence: medium)
- Rendering: SSR with hydration for public pages, client rendering for dashboards (Proposed). [Technology stack, Rendering; A10] (2026-10-03, confidence: medium)
- Texts written by people (reviews, notes) are shown as written; brand, garage and people's names are never translated. [feature page, Rules; ST-18] (2026-10-03, confidence: high)

## Constraints

- The sibling stories build on ST-16's public surface, so it must expose: a settable current language (ST-17 stores it under `mf.lang`, syncs tabs, lets the account's language win at sign-in); a language that formats can react to instantly (ST-19: pipes live in `libs/i18n`, "every format changes at once, with no reload"); server rendering in a given language with `lang` set (ST-21). [ST-17, ST-19, ST-21 Build briefs] (2026-10-03, confidence: high)
- ST-18 (to do) will add a check and helpers: non-breaking hyphen U+2011 in Romanian words such as "service-ul", and a user-text component that never passes text through the translator; ST-16's files and checks must not block that. [ST-18 Build brief] (2026-10-03 17:38, confidence: medium)
- ST-157 (shared dialog, `libs/overlays`) and ST-159 (shared saving, validation and errors) both list ST-16 under Depends on; ST-159 requires "each code has a message key in both languages" with RFC 9457 codes (A28, proposed; A42 snake-case codes). [ST-157, ST-159 Build briefs; Architecture decisions A28, A42] (2026-10-03, confidence: high)
- Dashboards are client-rendered and public pages server-rendered, so the file loader must work on both server and browser. [Technology stack, Rendering] (2026-10-03, confidence: medium)
- The monorepo story places "libs/i18n ... Text files and language switch" in the workspace layout. [ST-421 page, search excerpt] (2026-10-04, confidence: low: excerpt only)
- Plural forms need ICU message syntax, which Transloco does not provide by itself; the brief names ICU. [ST-16 Build brief] (2026-10-04, confidence: medium)

## Prior Art

- ST-17 switch, ST-18 one language per screen, ST-19 formats, ST-21 addresses, ST-157 dialog, ST-159 saving/errors: all status To do (none built); ST-16 is first in build order (Slice 1, after ST-421). [feature page "Stories, in build order"; EP-1 Build plan] (2026-10-03)
- The mock already has the RO / EN switch on every screen, saved in the browser and synchronised between tabs; there is no translation library in the mock. [feature page, Where it stands] (2026-10-03)

## Open Decisions

- Third language: "Is a third language ever needed?" — "Not needed for launch; the language list is one constant either way." Blocks nothing here. [ST-16 Open; feature Open questions] (2026-10-04)
- Machine translation of reviews: not at launch; blocks nothing here. [feature Open] (2026-10-03)
- Transloco and the key conventions, plurals, comma-below, fallback-from-build are all marked *(proposed)* and unconfirmed by the owner. [ST-16 Build brief] (2026-10-04)
- A28 (error codes as RFC 9457 `code` the front end translates) is **Proposed**, not decided; A42 (lower snake case codes) Proposed. [Architecture decisions] (2026-10-03)

## Contradictions with spec.md

- **spec.md** (2026-10-04): Clarification "Q: The Build brief's scenario 6 (API error codes shown through keys, A28 proposed) — in scope? → Deferred to the first story that shows an API error to a person" — **Notion**: the story's Build brief lists scenario 6 among its acceptance scenarios ("the message shown comes from a key for that code, in the person's language (A28 proposed)"); ST-159 later consumes "a message key in both languages" per code. [ST-16 Build brief; ST-159] (2026-10-04) — newer: same day, the deferral is an autonomous default and the story is the scope authority; the Notion side stands until the owner or `/speckit-clarify` accepts the deferral.
- **spec.md** (2026-10-04): "The brief's end-to-end switch on Home with the sign-in dialog open ... moves to ST-17" — **Notion**: Build brief Tests for ST-16 name this end-to-end test. [ST-16 Build brief, Tests] (2026-10-04) — newer: same day. The Notion side puts the test in ST-16; ST-17 lists a different end-to-end (two tabs). The dialog does not exist yet (ST-157 depends on ST-16), so the test cannot be written as stated.
- **spec.md** (2026-10-04): FR-004 "project checks ... fail when a web app template contains interface text" — **Notion**: "a lint rule flags it (proposed)". [ST-16 Build brief scenario 2] — AGENTS.md says Biome only; a Biome rule for Angular templates may not exist, so a project check script is a reasonable reading, not a conflict. Recorded for the plan.
- **spec.md** (2026-10-04): Sources line cites "page edited 2026-10-03" — **Notion**: story page last edited 2026-10-04T05:24Z (status In progress; likely the start sync). Content changes since spec.md's read cannot be told apart. [ST-16] (2026-10-04) — newer: Notion (possibly only the status).

## Proposed Clarifications (this command's proposals, not requirements)

- Confirm that scenario 6 (error code to key) is deferred, and where it lands: ST-159 or the first story showing an API error. — from the contradiction above
- Confirm Transloco (with an ICU plugin) as the library, since the stack page marks it Proposed; the spec names no library. — from Decisions, Open Decisions
- Decide where the switch API is specified for ST-17, ST-19 and ST-21 (current-language signal, set function, SSR language input) so their briefs can depend on it. — from Constraints
- Decide how the template check is implemented given Biome-only lint. — from Contradictions
- Add "Sentences are never glued together from pieces" and the `libs/i18n` location to the spec if wanted; neither appears in spec.md. — from Decisions

## Gaps

- [NEEDS CLARIFICATION: where the SSR language comes from before ST-21 — the spec says every visit starts in Romanian; ST-21 redirects `/` to `/en/` when the device remembers English]
- The Open decisions page (64k characters) was not fully read; only search excerpts. No numbered open decision about i18n was seen in them.
- ST-17's `mf.lang` key and ST-21's `x-default` are not ST-16 scope; recorded only as consumers.

## Sources

- Set up translation files and runtime language switching (ST-16) — https://app.notion.com/p/3ee607bff0d281c3927ec1b8e980be00
- Romanian and English interface (MF-1) — https://app.notion.com/p/3ee607bff0d281618e30f8787e2c3dd3
- Foundations (EP-1) — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
- Technology stack — https://app.notion.com/p/3ee607bff0d2819ab8e3ee6926a249f2
- Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
- ST-17 Switch the interface — https://app.notion.com/p/3ee607bff0d28131b3c1e5856c0e50bf
- ST-18 One language per screen — https://app.notion.com/p/3ee607bff0d28104acfbf6d2ef09ee7a
- ST-19 Formats — https://app.notion.com/p/3ee607bff0d28180a6a4e24b1d161a9b
- ST-21 Web address per language — https://app.notion.com/p/3ee607bff0d281bbaa1de24ea602b2a2
- ST-157 Shared dialog and drawer — https://app.notion.com/p/3ee607bff0d2811db730c1017d198dd2
- ST-159 Shared saving, validation and errors — https://app.notion.com/p/3ee607bff0d28158a0bee4952af0d856
- Design mock (recorded, not opened) — https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr

## Refresh 2026-10-04

No changes since 2026-10-04. Re-read ST-16 (body and comments: none, page last edited 2026-10-04T05:24Z, the start sync already recorded above), MF-1 (2026-10-03T18:45Z), ST-17 (2026-10-03T17:38Z), ST-19 (2026-10-03T17:32Z), ST-157 (2026-10-03T17:33Z), ST-159 (2026-10-03T17:34Z) and Architecture decisions (2026-10-03T19:08Z); every body matches what is recorded above. ST-17, ST-19, ST-157 and ST-159 remain To do. ST-18 and ST-21 were not re-read in this refresh.
