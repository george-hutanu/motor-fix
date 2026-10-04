**Agent review: failure** — PR #53 at `85d761a`, lap 4

Blocking: 1 (blocker 0, high 1) · medium 2 · low 3. Booted: postgres, redis, api, web, worker.
- No Docker on this machine: private PostgreSQL and Redis on free ports, no object store.
- No changed GET endpoint without path parameters.

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | high | FR-016 not met: an address that cannot be read is counted instead of leaving the limit skipped |  | Live probe on the booted PR head (pr-53-lap4-probe/report.md): codes 201,201,201,201,201,201,201,201,201,201,429,429. FR-016 ends: "an address that cannot be read leaves the limit skipped, as an unreachable Redis does", and says it holds "for the sign-up limit and for sign-in's per-address count alike". The unit spec asserts the opposite: attempts.spec.ts `['something that is no address', 'not-an-address', 'not-an-address']`. Fix tests first: clientOf returns null when `isIP(bare) === 0` (empty included); admitSignUp returns true and logs, and Attempts.blocked/fail skip the address key, when it is null; change that spec row and add an integration case (empty/garbage address admitted past 10). |
| 2 | medium | api readiness: storage down |  |  |
| 3 | medium | worker readiness: storage down |  |  |
| 4 | low | Not a defect: the 390 px RO light phone sign-up hit the hourly limit in the QA run (test artifact) |  | QA harness, not the change. Every browser sign-up in this run reached the API as one client, so the 11th counted sign-up (this one) got 429 too_many_attempts, as FR-006 says. Rerun on a fresh boot (pr-53-lap4-probe): the same flow at 390 px RO light passed 3 of 3, plus 390 EN light, 320 RO dark and 390 RO dark, all landing on /app/driver. Original: page.waitForURL: Timeout 15000ms exceeded. \| =========================== logs =========================== \| waiting for navigation until "load" \| ============================================================ |
| 5 | low | Show/hide password keeps one label ('Show password' / 'Arată parola') while pressed |  | `[attr.aria-label]="'public.signUp.showPassword' \| t"` with `[attr.aria-pressed]="shown()"`. A valid toggle-button pattern, carried over from lap 2 as a note only. |
| 6 | low | Browser sign-ups reach the API as one client through the web app in the booted stack |  | Seen in pr-53-lap4 (flow-signup-320-dark-en.png and flow-signup-tablet-dark-ro.png show 'Too many attempts' where a taken e-mail was expected). Locally the web proxy's hop decides req.ip. This is the case deferred.md's first item names for Railway (the whole site sharing 10 sign-ups an hour); verify on staging as that Notion task says. Not a new defect in this change. |

### Reproduction
1. Boot the PR head; from a trusted hop (loopback) POST /api/v1/auth/sign-up 12 times with a valid JSON body and X-Forwarded-For: not-an-address, so req.ip is 'not-an-address' → The answers are 201 x10, then 429 too_many_attempts x2: the unreadable address got its own counter → Read the code: the controller passes `req.ip ?? ''`, and `clientOf` does `if (!isIPv6(address)) return address;`, so '' and any non-IP string become a Redis key (every request with no readable address shares the one key digest(''))
2. No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.
3. No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.
4. phone sheet switch + sign-up 390 ro light
5. Open sign-up and press the eye button: aria-pressed turns true and the field becomes text, the label stays 'Arată parola'
6. Drive more than 10 sign-ups through the browser on the booted head, each page adding its own X-Forwarded-For → The 11th is refused 429 even though the pages used different addresses

Screenshots: 48, one per route × viewport × scheme × language.
