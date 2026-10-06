**Agent review: failure** — PR #152 at `083f542`, lap 2

Blocking: 1 (blocker 0, high 1) · medium 2 · low 3. Booted: postgres, redis, minio, api, web, worker.
- Ran on GitHub Actions: PostgreSQL with PostGIS, Redis and MinIO from the PR's own compose file, started by the PR QA workflow.
- Called the changed operations: POST /api/v1/invites/check → 410; POST /api/v1/invites/accept → 410.
- Not called: POST /api/v1/garages/{garageId}/invites: GET /api/v1/garages answered 404, so there is no {garageId} to call it with; POST /api/v1/garages/{garageId}/invites/{id}/resend: GET /api/v1/garages answered 404, so there is no {garageId} to call it with; POST /api/v1/garages/{garageId}/invites/{id}/revoke: GET /api/v1/garages answered 404, so there is no {garageId} to call it with.
- Unit and end-to-end tests left to CI (Unit tests and E2E tests; the merge gate waits for them).

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | high | flow not run: an existing account signs in from the link and accepts (US2 scenarios 2, 4, 5; FR-007, FR-012) | /ro/invite/:token | .specify/.cache/qa-flows-152.mjs:163: const jsteps = ["send a mechanic invite as the owner", "open its link signed out at 390 px", "tap Acceptă", "create the account in \"Cont nou\""]; -- the only acceptance the flows drive is a new account; the driver signed in at line 73 is used only to be refused |
| 2 | medium | not swept (persisting from lap 1, narrowed): /app/garage@garage and /{lang}/invite/:token at tablet and desktop, and the dialog in English | /app/garage@garage | shots/flow-invite-dialog-320-dark.png, shots/flow-invite-valid-390-dark.png are the new screens; no flow-* shot is wider than 390 px |
| 3 | medium | FR-007 and plan.md still promise a session from accept; it answers 204 (lap 1 #5, user-facing part fixed) |  | libs/domain/src/garages/staff-invite.controller.ts:106: @HttpCode(HttpStatus.NO_CONTENT); specs/131-invite-garage-staff/plan.md:87: \| The accept answer is the role switch's \| |
| 4 | low | Resend audit entry records no permissions (FR-010), persisting from lap 1 and not in deferred.md |  | libs/domain/src/garages/staff-invite.service.ts:158: kind: 'invite_resent', |
| 5 | low | The invite e-mail is sent inside the request (constitution: slow work runs in the worker), justified in plan.md Complexity Tracking; recorded, no change asked |  | libs/domain/src/garages/staff-invite.service.ts:400: await this.brevo.send({ |
| 6 | low | The report's 'Ran on GitHub Actions' note is wrong again: lap 2 ran locally (run.mjs --tree, Actions dispatch refused 403) |  | report.md:4: - Ran on GitHub Actions: PostgreSQL with PostGIS, Redis and MinIO from the PR's own compose file, started by the PR QA workflow. |

### Reproduction
1. Send a mechanic invite as the owner; open its link signed out and choose 'Intră în cont' as the seeded driver (sofer@example.test): nothing is accepted until 'Acceptă' is pressed (FR-012) → Press 'Acceptă': the account keeps the driver role, gains mechanic, lands on /app/garage as Mecanic and can switch back to Șofer → Send a receptionist invite and accept it signed in: the receptionist role and a garage membership, no mechanic row (scenario 4) → The lap 1 fix (retry only the role switch) sits on exactly this signed-in path; the flows drive only the sign-up half, so the QA run never exercised it
2. Lap 2 adds dark shots of the dialog (320 px) and the valid invite page (390 px) → Still no tablet or desktop screen of either changed route, and the invite dialog only in Romanian → Shoot both routes at 768 and 1280 px and the dialog in English in the flows, or give the sweep a load condition that does not wait on /api/v1/live
3. 083f542 makes a retry after a failed switch call only switchRole (invite.ts joined flag, unit-tested): resolved for the user → The records still say otherwise: spec FR-007 'The answer MUST switch the session to the invited role (a new access token, as the role switch does)' and plan.md:87 → Either answer the SessionDto from accept or record the two-call design as the deviation in spec/plan
4. Resend an invite; the invite_resent audit row carries no permissions; the accept gap is deferred, this one is not
5. Send an invite: Brevo is called in the request
6. run.log: 'run: tree /home/user/motor-fix at 083f542'; report.md still says Ran on GitHub Actions

Screenshots: 32, one per route × viewport × scheme × language.

### Lap 1 findings against lap 2
- #1 accept a valid link (high): signed-out sign-up half resolved (flow-join-signup/landed/reopen-390.png: lands as Mecanic, link then invalid, check 410); signed-in half not driven, carried as #1.
- #2 resend and revoke (high): resolved; the flows drive resend (old link 410, new 200), revoke (204, then 409) and a driver refused on both.
- #3 mechanics off (high): resolved at the API (mechanic invite 404 feature_off, receptionist 201, a link sent before no longer checks); the dialog's feature_off branch is unit-tested.
- #4 not swept (medium): narrowed, persists as #2.
- #5 accept 204 / retry shows invalid (medium): retry fixed in 083f542 with a unit test (invite.spec.ts); spec/plan drift persists as #3.
- #6, #7, #8 (low): persist as #4, #5, #6.
