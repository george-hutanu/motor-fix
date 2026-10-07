# Requirements-quality Checklist: Open the admin dashboard and its menu, admins only

**Purpose**: Unit tests for the requirements of ST-160: the 404 policy, live updates, i18n and the phone layout.
**Created**: 2026-10-07
**Feature**: [spec.md](../spec.md)

**Review Ownership**: reviewer-owned; `[x]` means the requirements-quality criterion is satisfied, not that code is done. In this autonomous run the phase agent evaluated each item against the spec and plan; gaps were fixed in the spec first (noted per item).

## Security (404 policy)

- [x] CHK001 Is the answer for each actor class (visitor, suspended, non-admin role, admin) stated for `admin/*`, with its status and code? [Completeness, Spec §FR-002, US1-2/3]
- [x] CHK002 Is the order of refusals (401 before 404, 403 for suspended) unambiguous? [Clarity, Spec §FR-002]
- [x] CHK003 Is "the same body a missing resource gives" testable against a named problem code? [Measurability, Spec §US1-2, contracts/admin-overview.md]
- [x] CHK004 Does a test requirement cover every `admin/*` route, including ones added later, rather than a fixed list? [Coverage, Spec §FR-002, plan R2]
- [x] CHK005 Is the mixed-role account (admin plus another role) addressed? [Edge Case, Spec §Edge Cases]
- [x] CHK006 Is the rule that no screen or endpoint grants `admin` stated and bounded to this story? [Completeness, Spec §FR-004, US1-5]
- [x] CHK007 Is the behaviour under maintenance mode specified for admins? [Coverage, Spec §FR-003, US1-4]
- [x] CHK008 Is the capability guarding the overview named and justified for all four non-admin roles? [Assumption, Spec §Assumptions]
- [x] CHK009 Do the web redirect (FR-005) and the API 404 (FR-002) agree on what each role sees? [Consistency, Spec §FR-005, SC-001]

## Live updates

- [x] CHK010 Are the triggering events listed by kind, with the matching rule (kind, not object id) stated? [Clarity, Spec §FR-012]
- [x] CHK011 Is it stated which events do not change the count (`verification.opened`)? [Edge Case, Spec §Edge Cases]
- [x] CHK012 Is burst behaviour (two events inside 300 ms) specified? [Coverage, Spec §Edge Cases, FR-012]
- [x] CHK013 Are reconnect and token-expiry flows specified? [Coverage, Spec §US3-4, Edge Cases]
- [x] CHK014 Are loading, failed-read and recovered states defined, with "never 0, never stale"? [Completeness, Spec §FR-011, US3-5/6]
- [x] CHK015 Is the "within 2 seconds" claim reconciled with what this story measures? [Conflict, Spec §SC-003, Clarifications]
- [x] CHK016 Is the exclusion of review events until MF-45 explicit and consistent between FR-010, FR-012 and the edge cases? [Consistency]
- [x] CHK017 Is the dependency on ST-116's submit endpoint, and the resulting deviation, recorded? [Dependency, Spec §FR-015]

## i18n

- [x] CHK018 Are Romanian `one`/`few`/`other` and zero forms, and English forms, given verbatim? [Completeness, Spec §FR-008]
- [x] CHK019 Is the U+2011 rule stated for hyphenated Romanian words? [Clarity, Spec §FR-014]
- [x] CHK020 Is the language switch's effect on every shell text specified, including accessible names? [Coverage, Spec §FR-009, FR-010, US2-6]
- [x] CHK021 Where the story and the Build brief disagree ("ADMIN" vs "ADMINISTRATOR"), is the winner stated? [Conflict, Spec §Assumptions, design.md]
- [x] CHK022 Are the tab-bar short labels given in both languages? [Gap -> fixed: FR-006 gives RO short labels; EN follows the shell catalogue keys in plan, EN menu names in US2-1] [Completeness, Spec §FR-006]
- [x] CHK023 Is the fixed city text and its replacement story named? [Assumption, Spec §FR-008]

## Phone layout

- [x] CHK024 Are the breakpoints (768 px switch) and the tested widths (320, 390, tablet, desktop) specified? [Completeness, Spec §FR-006, SC-002]
- [x] CHK025 Is "readable" for the header line quantified (wrap, no sideways scroll at 320 px)? [Measurability, Spec §FR-014, US2-5]
- [x] CHK026 Is the minimum text size consistent across the spec and design note? [Conflict -> fixed: design.md said tab label 11 px, FR-014 said 12 px; design.md now 12 px, FR-014 names tab labels and 48 px touch targets] [Consistency, Spec §FR-014]
- [x] CHK027 Is the counter's appearance for large numbers defined? [Gap -> fixed: FR-010 adds "99+" with full number in the accessible name] [Edge Case, Spec §FR-010]
- [x] CHK028 Is the hidden-entry rule defined for the tab bar as well as the menu, and its address fall-through? [Coverage, Spec §FR-007, SC-004]
- [x] CHK029 Is the mock's unavailability and the Build-brief-wins rule recorded? [Assumption, design.md]
