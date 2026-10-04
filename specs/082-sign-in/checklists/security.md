# Security requirements checklist: sign-in

**Purpose**: are the sign-in requirements complete and unambiguous on credential handling, sessions and abuse?
**Created**: 2026-10-04 · **Feature**: [spec.md](../spec.md)

## Credentials
- [x] CHK001 Is the hashing algorithm and its parameters specified? [Clarity, FR-003, Assumptions]
- [x] CHK002 Is a constant-time comparison required? [FR-003]
- [x] CHK003 Are all "no such credential" cases required to answer identically, including no-password and deleted accounts? [FR-002, SC-002]
- [x] CHK004 Is the unknown-e-mail path required to do the same work as a wrong password? [FR-002, Edge Cases]
- [x] CHK005 Is logging the password, the e-mail or the address ruled out? [FR-011]

## Sessions
- [x] CHK006 Are the cookie flags, path and lifetimes specified for both tick states? [FR-007]
- [x] CHK007 Is the refresh token stored only as a hash? [FR-007]
- [x] CHK008 Is rotation on every use, and reuse closing the family, specified with the two-tab exception bounded in time? [FR-008, FR-009]
- [x] CHK009 Does renewal re-check the account's status and roles, and revoke on failure? [FR-008]
- [x] CHK010 Is the access token kept out of storage the page or other scripts can read? [FR-018]
- [x] CHK011 Is sign-out required to revoke server-side, not only forget in memory? [FR-010, FR-020]
- [x] CHK012 Is cross-site request forgery addressed for the cookie-bearing calls? [FR-007 SameSite=Strict + path; research.md]

## Abuse
- [x] CHK013 Are per-e-mail and per-address limits quantified, including what counts and what clears? [FR-005]
- [x] CHK014 Can a third party keep someone's account locked indefinitely? [FR-005: refusals are not counted — no]
- [x] CHK015 Is the behaviour when the counter store is down specified? [FR-005]
- [x] CHK016 Is the client address source protected against a spoofed header? [Assumptions, research.md]

## Access
- [x] CHK017 Are suspended accounts and maintenance refusals specified with codes? [FR-004, FR-006]
- [x] CHK018 Can a public call create or grant a role here? [No: sign-in only reads roles; 079-FR-009 unchanged]
- [x] CHK019 Are seeded credentials kept out of deployed environments' reach? [FR-023: staging needs SEED_PASSWORD, production refused]
