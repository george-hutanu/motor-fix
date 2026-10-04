# Requirements Quality Checklist: platform (health, promotion, secrets)

**Purpose**: Test whether the requirements for the health contract, the promotion rule and the secrets/environment rules are complete, clear and consistent.
**Created**: 2026-10-04
**Feature**: [spec.md](../spec.md)

`[x]` means the requirement-quality criterion is satisfied. Under /speckit-auto the run evaluated each item, fixed the spec where it fell short, and recorded the fix.

## Health contract

- [x] CHK001 - Is the response shape specified for both the 200 and the 503 ready answers, including `version`? [Completeness, Spec §US3] — fixed: US3-3 now says "the same shape … and `version`"
- [x] CHK002 - Is the 2-second limit stated per dependency rather than for the whole check? [Clarity, Spec §FR-013]
- [x] CHK003 - Is "web is ready once it can render" stated in a way that can be measured? [Measurability, Spec §FR-014] — fixed: "answering is the check"
- [x] CHK004 - Do the liveness requirements cover every process that has an image, `mcp` included? [Coverage, Spec §FR-012]
- [x] CHK005 - Is it consistent which processes forward `/health/*` and which answer it? [Consistency, Spec §FR-014, §FR-020]

## Promotion rule

- [x] CHK006 - Is it specified what happens to a pending production approval when a newer commit passes staging? [Edge Case, Spec §FR-030]
- [x] CHK007 - Are time limits defined for both the staging and the production health waits? [Completeness, Spec §FR-028, §FR-029]
- [x] CHK008 - Are failure requirements defined for a migration failing on production, not only on staging? [Gap, Edge Cases] — fixed: edge case added
- [x] CHK009 - Is "the same image" defined precisely enough (digest, not tag) to be checked? [Clarity, Spec §US5-2]
- [x] CHK010 - Are the checks that can only be shown by hand named, with a place to record their outcome? [Gap, Spec §SC-004] — fixed: FR-034 added

## Secrets and environment rules

- [x] CHK011 - Is the set of required variables defined per app, with defaults for the rest? [Completeness, Spec §FR-021]
- [x] CHK012 - Is the behaviour for an `APP_ENV` value outside the allowed list specified? [Edge Case, Spec §FR-023; data-model.md]
- [x] CHK013 - Is it specified what may appear in the log line for a missing variable (name, never value)? [Clarity, Spec §FR-021]
- [x] CHK014 - Are the production-only restrictions (seed, `/api/docs`) listed in one place and consistent with A33? [Consistency, Spec §FR-018, §FR-025; data-model.md]
- [x] CHK015 - Is the "Reset staging" workflow's inability to reach production stated as a requirement rather than an assumption? [Clarity, Spec §FR-031]

## Notes

- 15/15 pass after 4 spec fixes (US3-3, FR-014, a production-migration edge case, FR-034).
