# Feature Specification: E-mail links carry a safe scheme

**Feature Branch**: `540-email-link-scheme`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "ST-540 (Notion https://app.notion.com/p/3ef607bff0d281199d95ca3170698652, tech debt from ST-195, PR #67): the e-mail button's href (and the stop link's href) is HTML-escaped but its URL scheme is not checked. Refuse to render an e-mail whose button or stop link is anything but https:, or http: on a local host (localhost / 127.0.0.1, as CI's PUBLIC_WEB_URL http://localhost:4200 uses). Code: libs/domain/src/notifications/email-layout.ts:36 (emailHtml) and templates.ts render() email case, which already fails with TemplateError for bad values; the processor and template-check already handle TemplateError. Out of scope: push/SMS/WhatsApp links, a configurable allowlist, no UI or contract change."

Notion: ST-540 https://app.notion.com/p/3ef607bff0d281199d95ca3170698652 (Task, Low, tech debt from ST-195, found by pr-tester on PR #67, 2026-10-05). The page has no comments; its text is the finding alone.

## Finding, verified against the code

- `libs/domain/src/notifications/email-layout.ts:36` and `:27` put the button's and the stop link's `href` into the HTML after escaping it, and nothing checks what the value is: a link value of `javascript:…` or `data:…` reaches the e-mail as a working link.
- `libs/domain/src/notifications/templates.ts` `render()` (email case) takes both hrefs from a `link` value, which `format()` only stringifies; every other bad value already fails with `TemplateError`, which `notifications.processor.ts` (row set `failed`, reason `template_failed`) and `template-check.ts` (reported problem) already handle.
- CI's `PUBLIC_WEB_URL` is `http://localhost:4200` (`.github/workflows/ci.yml:158`), so `http:` on a local host must stay allowed; `template-check.ts` renders with `https://motorfix.example`.

## Clarifications

### Session 2026-10-06

- Q: When the stop (or button) link is absent, does the render refuse? → A: No: only a value that becomes an href is checked; an e-mail with no stop link renders as today, and an empty string is refused (it is not a URL).
- Q: Does the check live in `emailHtml` or in `render()`'s email case? → A: In `render()`'s email case, through its `fail`, so the refusal is a `TemplateError` carrying the template and channel; `emailHtml`'s only caller is `render()` (`templates.ts:180`).
- Q: Is the link name carried in the `TemplateError` message only, with the worker row reason staying `template_failed`? → A: Yes.
- Q: Which specs must be red first? → A: Scenarios 3–5 (button and stop link); scenarios 1–2 are regression guards that pass before and after.
- Q: Is "exactly localhost or 127.0.0.1" applied to the parsed hostname or the raw text? → A: The parsed, normalised hostname (`new URL(...).hostname`), so `http://LOCALHOST/x` is local.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An e-mail never carries a link of an unsafe scheme (Priority: P1)

A person who receives a MotorFix e-mail can trust that its button and its stop link open the MotorFix site over HTTPS. If a link value that reaches a template ever has another scheme, no e-mail is sent: the render refuses, and the existing handling of a failed render records it.

**Why this priority**: the only story; the finding is a safety hole.

**Independent Test**: render the e-mail channel with each link value below and check that it renders or refuses.

**Acceptance Scenarios**:

1. **Given** a button link `https://motorfix.test/x?t=a&b=<x>`, **When** the e-mail renders, **Then** it succeeds and the HTML carries that href, escaped, as today.
2. **Given** a button or stop link `http://localhost:4200/x` or `http://127.0.0.1:4200/x` (any port, or none), **When** the e-mail renders, **Then** it succeeds.
3. **Given** a button or stop link `http://motorfix.ro/x` (http on any host that is not local), **When** the e-mail renders, **Then** it refuses.
4. **Given** a button or stop link `javascript:alert(1)`, `data:text/html,…`, `/relative/path`, `motorfix.ro/x` (no scheme), or `not a url`, **When** the e-mail renders, **Then** it refuses.
5. **Given** a template with a stop link whose value is refused while its button link is fine, **When** the e-mail renders, **Then** it refuses: the stop link is checked exactly as the button link is.
6. **Given** a refused e-mail in the worker, **When** the job runs, **Then** the rows are set `failed` with reason `template_failed` and nothing is sent, as for any failed render today; **Given** the template self-check, **Then** a template whose example link is refused is listed as a problem.

### Edge Cases

- Credentials in an accepted URL (`https://user@host/`) and the destination host of an `https:` link are not judged: only the scheme and the local-host exception are in scope.
- Scheme case: `HTTPS://motorfix.ro` is accepted (schemes are read case-insensitively, as a browser reads them).
- A local host is exactly `localhost` or `127.0.0.1` as the parsed URL's hostname, with any port; `localhost.evil.com`, `127.0.0.1.evil.com` or `[::1]` are not local and are refused over http.
- Push, SMS and WhatsApp links, and the plain-text part's own text, are unchanged: only the e-mail render refuses, and when it refuses neither the HTML nor the text part is produced.
- The reason of the refusal names which link (button or stop) was refused, so the worker's log and the self-check say what is wrong.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The e-mail render MUST accept a button or stop link only when its scheme is `https`, or `http` with the host `localhost` or `127.0.0.1` (any port); it MUST refuse every other value, including `http` on any other host, `javascript:`, `data:`, a relative path, a host without a scheme, an empty string, and text that is not a URL. Leading and trailing whitespace is ignored as URL parsing ignores it; the href written into the HTML is the parsed value's source text, escaped as today.
- **FR-002**: A refused link MUST fail the whole e-mail render through the existing template failure (`TemplateError`) with a reason naming the link (button or stop), so the worker marks the rows `template_failed` and sends nothing, and the template self-check reports it, with no change to either.
- **FR-003**: The check MUST apply to the stop link exactly as to the button link.
- **FR-004**: Push, SMS, WhatsApp and bell rendering, the e-mail HTML for accepted links, the contracts and the web app MUST be unchanged; the allowed set is fixed in code, with no configuration.

### Key Entities

None.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The colocated Jest specs for scenarios 3–5 (button and stop link each) fail before the change and pass after it; scenarios 1–2 pass before and after.
- **SC-002**: The existing template specs and the template self-check still pass: every shipped template renders with the example app URL `https://motorfix.example`.
- **SC-003**: `npm run test:unit` for the domain library, typecheck and lint are green.

## Assumptions

- The check lives in `render()`'s email case and refuses through `TemplateError` as every other bad value does; no new error type. The worker row reason stays `template_failed`; the link name is in the error message. An absent stop link is not checked. (autonomous default)
- The local hosts are exactly `localhost` and `127.0.0.1`; `[::1]` and other loopback names are not added, since nothing in the repo uses them (`PUBLIC_WEB_URL` in CI is `http://localhost:4200`). (autonomous default)
- The scheme and host are read as a browser would (URL parsing), so scheme case does not matter and a value that does not parse as an absolute URL is refused. (autonomous default)
- The plain-text part is not produced for a refused e-mail, since the render fails as a whole; it needs no separate check. (autonomous default)
- No change to the catalogue, the templates, the contracts library, the web app or any configuration: the allowed schemes are fixed in code. (autonomous default)
- Level 2 was the pending default; this is a small fix (one library, no contract), and the sizing is left to `level.mjs check`. (autonomous default)

## Spec Delta

### Capability: `notifications`

- **Adds**: FR-001, FR-002, FR-003, FR-004
- **Modifies**: none
- **Removes**: none

The capability had no requirement on what scheme an e-mail's button or stop link may carry: 194-FR-012 and the templates take a link from the caller and escape it only.
