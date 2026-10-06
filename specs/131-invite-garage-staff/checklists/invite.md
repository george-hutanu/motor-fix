# Staff Invite Checklist: Invite a mechanic or receptionist to the garage

**Purpose**: Requirements quality for the staff invite API, acceptance flow and invite dialog
**Created**: 2026-10-06
**Feature**: [spec.md](../spec.md)

**Review Ownership**: reviewer-owned requirements-quality artifact; `[x]` means the criterion is satisfied by the requirements, not that code is done. Struck items (`~~`) do not apply, with the reason.

## Requirement Completeness

- [x] CHK001 Are authorization outcomes defined for every actor class (owner, own receptionist/mechanic, other owner, anonymous) on send, resend, revoke? [Completeness, Spec §FR-002]
- [x] CHK002 Are the refusal cases of sending (open duplicate, feature off, already in team, owner's own e-mail) each given a status? [Completeness, Spec §FR-003, contracts]
- [x] CHK003 Are input limits (name length, e-mail length) stated in the spec, not only the contract? [Gap, Spec §FR-001] (fixed: FR-001 now states 2–80 and 254)
- [x] CHK004 Is the handling of permission flags sent with a receptionist invite specified? [Gap, Spec §FR-001] (fixed: stored false)
- [x] CHK005 Is the failure of e-mail delivery specified, including what the owner receives? [Completeness, Spec §FR-004]
- [x] CHK006 Are audit and event requirements listed for every state change (sent, resent, revoked, accepted)? [Completeness, Spec §FR-010]
- [x] CHK007 Are dialog field problems and API messages both required? [Completeness, Spec §FR-011]
- [x] CHK008 Is the acceptance screen's behaviour defined signed out, signed in, new account, and invalid link? [Coverage, Spec §FR-012]

## Requirement Clarity

- [x] CHK009 Is "expired" defined unambiguously as derived, never stored? [Clarity, Spec §FR-001]
- [x] CHK010 Is "same flow" for acceptance bounded (account created vs. signed in needing an explicit click)? [Clarity, Spec §FR-012, Clarifications]
- [x] CHK011 Is it stated whose language each surface uses (e-mail, acceptance screen)? [Clarity, Spec §FR-004, Edge Cases]
- [x] CHK012 Is the role granted defined as coming from the invite row, never the request? [Clarity, Assumptions]

## Requirement Consistency

- [x] CHK013 Do `feature_off` requirements agree across send, open and accept? [Consistency, Spec §FR-003, FR-006, FR-008]
- [x] CHK014 Do resend and revoke statuses agree between the stories and FR-005? [Consistency, Spec §US3, FR-005]
- [x] CHK015 Do the spec's error codes agree with the contract's, including the HTTP statuses of check and accept? [Consistency, contracts/staff-invites.md]
- [x] CHK016 Is the permission rule for a receptionist consistent between FR-001 and the dialog (ticks shown for mechanic only)? [Consistency, Spec §FR-001, FR-011]

## Scenario and Edge Coverage

- [x] CHK017 Is accepting an expired link defined? [Gap, Spec §FR-007] (fixed: `invite_expired`)
- [x] CHK018 Is the concurrent double-accept outcome defined? [Edge Case, Gap, Spec §FR-007] (fixed: one wins, other `invite_invalid`)
- [x] CHK019 Are accepting as owner, as another garage's receptionist, as an already-holding account, and as suspended/deleted covered? [Coverage, Spec §Edge Cases, FR-008]
- [x] CHK020 Is the move from another garage defined, including permissions and live updates to both garages? [Coverage, Spec §US2.6, FR-009]
- [x] CHK021 Is the unknown/malformed token defined as indistinguishable from used ones? [Edge Case, Spec §FR-006, SC-003]

## Acceptance Criteria Quality

- [x] CHK022 Is every success criterion tied to a named test layer? [Measurability, Spec §SC-001..SC-007]
- [x] CHK023 Is the responsive/dark/language sweep stated measurably (320/390/tablet/desktop, no sideways scroll)? [Measurability, Spec §SC-007]

## Non-Functional, Dependencies and Scope

- [x] CHK024 Is the markup-safety of typed names, e-mails and garage names required? [Coverage, Spec §FR-013]
- [x] CHK025 Are the dependencies (notifications queue limits, no booking model, no phone sign-up) documented with what is deferred? [Dependency, Spec §Out of scope]
- [x] CHK026 ~~Are rate limits defined for send, resend and the public check call?~~ N/A: one open invite per address, owner-only sending and a 32-byte random token leave no abuse path this story adds; a limit would be speculative (Constitution I).
- [x] CHK027 ~~Are keyboard and focus requirements defined for the dialog and acceptance page?~~ N/A: both use the app's shared dialog and public-page shapes (Assumptions), whose accessibility is specified once there; SC-007 covers the sweep.
- [x] CHK028 ~~Are loading and sending states defined for the dialog?~~ N/A: the shared task dialog's pending state applies; no feature-specific state exists beyond the e-mail failure state (FR-004, FR-011).
- [x] CHK029 ~~Is a retention or cleanup rule defined for old invites?~~ N/A: no sweep job (Constitution I); rows stay as history, `expired` is derived.
