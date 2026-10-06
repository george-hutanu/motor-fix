# Feature Context: E-mail links carry a safe scheme

- **Feature**: 540-email-link-scheme
- **Anchor**: ST-540 Tech debt (ST-195): href scheme not checked — https://app.notion.com/p/3ef607bff0d281199d95ca3170698652 | terms: e-mail link, scheme, https, template
- **Gathered**: 2026-10-06
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature not read (small fix, no feature rules touched) | epic not read (properties only) | architecture not read (no data model, flow or sign-in change) | decisions not read (nothing here depends on a numbered decision)
- **Overall confidence**: high (for the story and its parent; scope is one finding)

## Story

- **ST-540 Tech debt (ST-195): safety: the button's href is escaped but its scheme is not checked** — status Planning, priority Low, role System, epic and feature same as ST-195, PR #168
- Scope per the story: "refuse anything but `https:` (and `http:` locally) once a template takes a link from outside the app". Where: `libs/domain/src/notifications/email-layout.ts:36`. Severity low, found by pr-tester on PR #67 (2026-10-05).
- Comments that moved scope: none (the page has no comments; its text is the finding alone).

## Decisions

- Parent ST-195's Build brief: a template that fails to render "is not sent. The row is `failed` with the reason, the error is logged" — a refused link fits this existing failure path. — [ST-195 Set up message templates in Romanian and English, States and errors] (2026-10-04, confidence: high)
- Templates live in the repository and change only through code review; no admin editor at launch. — [ST-195, Who can do it] (2026-10-04, confidence: high)

## Constraints

- Only ST-195's e-mail render is in scope; push, SMS and WhatsApp keep their own rules (push carries "a link that opens that screen"). — [ST-195, Acceptance scenarios 7-8] (2026-10-04, confidence: medium)
- Only NEWS carries an unsubscribe link (ST-201); the stop link in spec.md is the code's, not a Notion requirement. — [ST-195, Rules and validation] (2026-10-04, confidence: medium)

## Prior Art

- ST-195 (Done, PR #67): the e-mail layout with a single amber button whose link is escaped only — [ST-195] (2026-10-04)
- ST-81 tech debt (kept link/token in notification.params) is a sibling finding on the same link data, not this change — [Tech debt (ST-81)] (2026-10-05)

## Open Decisions

none found

## Contradictions with spec.md

none found. Note: the story names the button's href only; spec.md extends the check to the stop link (FR-003). Notion does not contradict this.

## Proposed Clarifications (this command's proposals, not requirements)

- Notion says "http: locally" without defining local; spec.md fixes it to `localhost` and `127.0.0.1`. Confirm that is the intended meaning — from the ST-540 finding text.
- The stop link is not mentioned in Notion; confirm checking it is wanted (spec FR-003 already does) — from the ST-540 finding text.

## Gaps

- Feature, epic, architecture and decisions pages were not read: the story is a one-line safety finding and nothing found points to them.
- No Notion page defines "local host".

## Sources

- ST-540 Tech debt (ST-195) — https://app.notion.com/p/3ef607bff0d281199d95ca3170698652
- ST-195 Set up message templates in Romanian and English — https://app.notion.com/p/3ee607bff0d2813dbda8c0e39bb8c756
- Tech debt (ST-81) — https://app.notion.com/p/3f0607bff0d2811cb685cb87e21ad087 (search result only)
