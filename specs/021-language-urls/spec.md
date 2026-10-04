# Feature Specification: Give each language its own web address for search engines

**Feature Branch**: `021-language-urls`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "ST-21 — Give each language its own web address for search engines: the /ro/ and /en/ prefixes, server rendering per language, hreflang alternates and the sitemap plumbing. Built on ST-16's i18n runtime and ST-17's RO/EN switch (switching language moves between /ro/ and /en/; opening an /en/ address directly renders English). The public pages it lists arrive in EP-4, so build the mechanism against the existing pages and placeholder routes. Notion story: https://app.notion.com/p/3ee607bff0d281bbaa1de24ea602b2a2. Spec folder and branch: 021-language-urls."

**Sources**: Notion story ST-21 https://app.notion.com/p/3ee607bff0d281bbaa1de24ea602b2a2 (read 2026-10-04, page edited 2026-10-03; no comments) — its Build brief wins over the story body · epic EP-1 Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707 (Build plan, slice 9: "the mechanism and the sitemap now, checked again when the public screens arrive in EP-4") · feature MF-1 https://app.notion.com/p/3ee607bff0d281618e30f8787e2c3dd3 · ST-17 https://app.notion.com/p/3ee607bff0d28131b3c1e5856c0e50bf (the switch, `mf.lang`)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Each language has its own address (Priority: P1)

A visitor opens `/en/` and reads Home in English straight from the server; a
visitor opens `/ro/` and reads it in Romanian. The address decides the language,
even when the device remembers the other one.

**Why this priority**: It is the story: without an address per language a search
engine can only ever see one language.

**Independent Test**: Fetch `/en/` and `/ro/` without JavaScript and read the
`lang` of the page and its texts.

**Acceptance Scenarios**:

1. **Given** nothing remembered, **when** `/en/` is fetched, **then** the server's
   HTML declares `lang="en"` and every interface text is English.
2. **Given** the device remembers Romanian, **when** `/en/` is opened in the
   browser, **then** the page stays English and the device now remembers English.
3. **Given** `/ro/`, **then** the page is Romanian, declaring `lang="ro"`.

---

### User Story 2 - The switch moves between the addresses (Priority: P1)

On `/ro/` the visitor taps "EN": the page turns English with no reload and the
address becomes `/en/`, replacing the current history entry. A language change
that reaches the tab from another tab moves the address the same way.

**Why this priority**: The switch from ST-17 must keep working, and the address
must never disagree with the language on screen.

**Independent Test**: On `/ro/`, tap "EN"; the address is `/en/`, the page did
not reload, and the history length did not grow.

**Acceptance Scenarios**:

1. **Given** `/ro/`, **when** EN is tapped, **then** the address is `/en/`, the
   page was not reloaded and Back does not lead to `/ro/`.
2. **Given** two tabs on `/ro/`, **when** EN is tapped in one, **then** the other
   shows English at `/en/` with no reload.

---

### User Story 3 - `/` leads to the language address (Priority: P2)

`/` still answers with Home in Romanian from the server. In the browser it moves
to `/ro/`, or to `/en/` when the device remembers English, replacing the history
entry. An in-app link to `/` (the logo, sign-out) lands on the address of the
current language.

**Why this priority**: Existing links and ST-17's "a reopened page is still
English" go through `/`.

**Independent Test**: With English remembered, open `/`; the address becomes
`/en/` and the page is English.

**Acceptance Scenarios**:

1. **Given** nothing remembered, **when** `/` is opened, **then** the server
   sends Romanian and the address becomes `/ro/`.
2. **Given** the device remembers English, **when** `/` is opened, **then** the
   address becomes `/en/` and the page is English.

---

### User Story 4 - Search engines find both languages (Priority: P1)

A search engine reading a public page finds its canonical address and the
addresses of both languages; `/sitemap.xml` lists both language addresses of
every public page; `/robots.txt` names the sitemap. Pages that are not public
tell search engines not to index them.

**Why this priority**: The acceptance criterion "a search engine can reach and
read both language versions".

**Independent Test**: Fetch `/en/`, `/sitemap.xml`, `/robots.txt`, `/app/driver`
and `/cockpit`, and read the links, entries and robots rules.

**Acceptance Scenarios**:

1. **Given** `/en/` rendered on the server, **then** it has a canonical link to
   `<origin>/en/` and `hreflang` links `ro` → `<origin>/ro/`, `en` →
   `<origin>/en/`, `x-default` → `<origin>/ro/`.
2. **Given** `/`, **then** its canonical link is `<origin>/ro/`.
3. **Given** `/sitemap.xml`, **then** it lists `<origin>/ro/` and `<origin>/en/`,
   each with the three alternates, and nothing else.
4. **Given** `/app/driver`, **then** the answer carries `X-Robots-Tag: noindex`;
   **given** `/cockpit`, **then** the page has `<meta name="robots"
   content="noindex">` and no canonical or `hreflang` link.

---

### User Story 5 - An unknown address is a not-found page (Priority: P3)

`/de/` or `/ro/no-such-page` answers 404 with a not-found page, marked
`noindex`: in Romanian for an unknown language prefix, in the address's language
when the prefix is known.

**Why this priority**: The brief's only error state; a crawler must not index a
wrong address as Home.

**Independent Test**: Fetch `/de/` and read the status, the language and the
robots rule.

**Acceptance Scenarios**:

1. **Given** `/de/`, **then** the status is 404, the page is Romanian and has
   `noindex`.
2. **Given** `/en/no-such-page`, **then** the status is 404 and the page is
   English.

### Edge Cases

- Storage blocked: an address's language still applies; nothing is remembered;
  `/` moves to the current language (Romanian on a fresh page).
- A remembered value that is not a supported language is ignored, as in ST-17.
- `/ro` and `/ro/` both open Romanian Home; the canonical form is `/ro/`.
- A query string after `/` is kept when the browser moves to the language
  address.
- Dashboards (`/app/…`) have no language prefix; the switch there changes the
  language only (no address to move).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every public page MUST have one address per language, `/ro/<path>`
  and `/en/<path>`, with the same `<path>` in both; today the public page is Home
  (`/ro/`, `/en/`), and pages added later under the prefix inherit it.
- **FR-002**: Pages rendered on the server MUST arrive in the language of their
  address — `<html lang>` and every interface text already filled in — and pages
  with no language prefix (`/` included) in Romanian, declaring `ro`. In the
  browser the address's language MUST win over the remembered one and become the
  remembered language (`mf.lang`) while storage is writable.
- **FR-003**: `/` MUST be rendered on the server in Romanian, as today; in the
  browser, arriving at `/` (opened directly or by an in-app link) MUST move to
  `/<language>` — the remembered language, else the current one — keeping the
  query string and replacing the history entry.
- **FR-004**: When the language changes on a page with a language address — a tap
  on the switch, or a change from another tab — the address MUST change to the
  same page under the new prefix through the router, with no reload and no new
  history entry.
- **FR-005**: A public page rendered on the server MUST carry a canonical link to
  its own language address and `hreflang` alternate links for `ro`, `en` and
  `x-default` (the Romanian address), all absolute on the public origin
  (`PUBLIC_WEB_URL`, else the request's origin); `/` carries those of `/ro/`.
- **FR-006**: `/sitemap.xml` MUST list both language addresses of every public
  page, each with its `ro`, `en` and `x-default` alternates, absolute on the
  public origin, and no other address.
- **FR-007**: `/robots.txt` MUST allow crawling and name the sitemap's absolute
  address.
- **FR-008**: Pages that are not public MUST tell search engines not to index
  them: every `/app/…` answer carries `X-Robots-Tag: noindex`; every other page
  that is not public (the cockpit sample, the not-found page) carries `<meta
  name="robots" content="noindex">` and no canonical or `hreflang` link.
- **FR-009**: An address the app does not know MUST answer 404 with a not-found
  page carrying `noindex` — in Romanian for an unknown language prefix, in the
  prefix's language under a known one — with a link to Home.

### Key Entities

- **Language address**: `/<language>/<path>`; the language is `ro` or `en`, the
  path is the same in both.
- **Public page**: a page under the language prefix (today Home); it is indexed,
  listed in the sitemap and carries canonical and `hreflang` links.
- **Remembered language**: `mf.lang` on the device (ST-17).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Both language addresses of every public page (today 2 of 2) return
  their language's HTML with JavaScript disabled.
- **SC-002**: After a language switch on a public page, the address shows the new
  language in 100% of cases, with zero reloads and zero added history entries.
- **SC-003**: The sitemap lists exactly the public pages' language addresses
  (today 2), and zero non-public addresses.
- **SC-004**: Zero non-public pages (dashboards, cockpit sample, not-found)
  answer without a `noindex` signal.

## Clarifications

### Session 2026-10-04

(filled by the clarify phase)

## Assumptions

- **`/` is not redirected by the server** (autonomous default). The brief's
  scenario 2 asks for a 302 to `/ro/`, "or to `/en/` when the device remembers
  English *(proposed)*". The server cannot read the device's storage, 016-FR-011
  and the orchestrator keep `/` Romanian on the server, and ST-17's e2e reopens
  `/` and expects English. So the server renders Romanian Home at `/` (canonical
  `/ro/`) and the browser moves to the language address. A server-readable
  cookie is not in the brief.
- **The address wins and is remembered** (autonomous default): opening `/en/`
  writes `mf.lang = en`, as a tap would. Otherwise a tab on `/en/` would be
  pulled back to the remembered Romanian after the first render, and the address
  and the screen would disagree. A consequence: other open tabs follow, as they
  do after a tap (ST-17 FR-007).
- **Placeholder pages are not added** (autonomous default, Principle I): the
  prefix is a parent route, so any page EP-4 adds under it inherits the address,
  the server language, the head links and the not-found handling. The sitemap
  takes its list from one place that EP-4 extends with garages, mechanics and
  brands; GARAGE, MECHANIC and BRAND do not exist in the schema yet.
- **The brief's data-backed sitemap rules are EP-4's** (scenarios 1, 4 beyond
  Home, 5, 6, 9; the cache drop on events): no garage, mechanic, brand, review
  rules, terms or privacy page exists yet. Confirmation, reset and invite links
  (scenario 8) do not exist yet either; they will live under `/app/` or carry
  `noindex` when built.
- The cockpit sample (`/cockpit`) is a developer page, not public; it keeps its
  address and is marked `noindex` (autonomous default).
- The canonical form of a language root is `/ro/` and `/en/` (the brief's form);
  the router may show `/ro` in the address bar, which serves the same page.
- Caching of public pages (Security page: Home 5 minutes) is not set here; no
  caching layer exists in `apps/web` yet (autonomous default, follow-up).

## Spec Delta

### Capability: `i18n`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009
- **Modifies**: `016-FR-011` → `FR-002`
