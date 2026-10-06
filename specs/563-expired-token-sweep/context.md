# Feature Context: Expired token in the route sweep

- **Feature**: 563-expired-token-sweep
- **Anchor**: ST-563 — https://app.notion.com/3f0607bff0d2811b8c7bc0729cbd6d73 (epic EP-1 Foundations — https://app.notion.com/3ee607bff0d281188cb4c6724bd45707) | terms: expired token, route sweep, sign_in_required, session
- **Gathered**: 2026-10-06
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story NOT READ | feature NOT READ | epic NOT READ | architecture NOT READ | decisions NOT READ
- **Overall confidence**: low

[UNAVAILABLE: notion — no Notion tools exist in this agent's tool list (only Read and Write; no ToolSearch to load search, fetch, get-comments or query-data-sources). No Notion call was attempted.]

The run stops here. This is an unreachable source, not "nothing found": no page
or comment of the space was read, so no finding below is evidence.

## Story

- **ST-563** — status unknown, priority unknown, role unknown, epic EP-1 Foundations (named by the caller, not read from Notion)
- Scope per the story: not read. `spec.md` quotes the page's done-when (secondhand, read 2026-10-06 by the spec author): "the sweep calls every route with an expired token and expects 401 `sign_in_required` on every gated route".
- Comments that moved scope: not read. `spec.md` says the page had no comments on 2026-10-06; unverified here.

## Decisions

none found (source unavailable)

## Constraints

none found (source unavailable)

## Prior Art

none found (source unavailable)

## Open Decisions

none found (source unavailable)

## Contradictions with spec.md

none found (source unavailable)

## Proposed Clarifications (this command's proposals, not requirements)

- Re-run `/speckit-context` with a session that has the Notion connector before `/speckit-clarify`: the story's comments, the EP-1 sibling auth stories, the Architecture security pages on sessions and access tokens, and open decisions on session expiry are all unread. This is this command's own proposal.

## Gaps

- [NEEDS CLARIFICATION: story ST-563 comments, if any, after 2026-10-06]
- [NEEDS CLARIFICATION: does any Architecture page or open decision set an access-token lifetime or expiry rule other than the 15-minute default assumed in spec.md?]
- Sibling auth stories in EP-1, and ST-130's own page, not read.

## Sources

- ST-563 — https://app.notion.com/3f0607bff0d2811b8c7bc0729cbd6d73 (not opened)
- EP-1 Foundations — https://app.notion.com/3ee607bff0d281188cb4c6724bd45707 (not opened)

## Refresh 2026-10-06 (anchor read by the run itself)

The org-researcher agent had no Notion tools in this session (its tool list
names other connector ids). The run read the anchor directly with the
session's connector, read-only:

- **Story changes**: ST-563 (https://app.notion.com/p/3f0607bff0d2811b8c7bc0729cbd6d73,
  last edited 2026-10-06T05:14Z by this run's Planning write) is a Task, Low,
  Labels backend, Role System, Status Planning, PR #146; no discussions. Body:
  tech debt from ST-130 (PR #64), recorded by PR #74; `specs/130-sign-in-gate`
  T001 asked for no-token, malformed and expired calls; the sweep lacks the
  expired one; it is tested once in
  `libs/domain/src/auth/actor.guard.adversary.integration.spec.ts`. Done when:
  the sweep calls every route with an expired token and expects 401
  `sign_in_required` on every gated route. Agrees with spec.md.
- **New contradictions with spec.md**: none.
- Architecture pages and open decisions on token lifetime stay unread (gap
  above kept); the spec does not depend on the lifetime beyond "clearly past".

## Refresh 2026-10-06 (phase 13)

ST-563 re-read: content unchanged, no comments; Status Implementing and PR #146 are this run's own writes. No new evidence.
