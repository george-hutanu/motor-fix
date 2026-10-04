# Context — 286-phone-layout

Gathered: 2026-10-04 · Source: Notion space "MotorFix — Product documentation" only; latest source wins.

The `org-researcher` subagent ran without the Notion connector this session
(`[UNAVAILABLE: notion — subagent had no Notion tools]`), so this digest was read
by the main run with the connector it has. The pages are cited; nothing below is
from memory.

## Sources

- Story ST-286 "Set up the shared phone layout rules" — https://app.notion.com/p/3ee607bff0d281df9a9ef85c0725362c (edited 2026-10-03; no page comments). Its Build brief wins over the story body.
- Epic EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707 (edited 2026-10-03). Build plan, slice 2: "the shared phone layout rules, manifest and service worker (needs ST-50)".
- ST-285 "Decide: installable web app or app-store apps" (Done) — https://app.notion.com/p/3ee607bff0d281299a1ae6725b9aec68 (A19).
- ST-196 "Set up push notifications" — https://app.notion.com/p/3ee607bff0d28156a023d73a7262de80 (edited 2026-10-03).
- Build timeline row — https://app.notion.com/p/3ee607bff0d281eb9cd3e9924534b1c1 ("Owns the web app manifest and the service worker that ST-196 (push) extends.")

## Decisions

- D1 Installable web app (PWA) with push and camera first; store apps later only if needed (ST-285, A19).
- D2 Smallest text on a phone is 12 px everywhere; the mock's 11 px tab labels are to be fixed (story Notes, superseded 2026-10-03; epic risks).
- D3 Breakpoints *(proposed)*: phone < 768, tablet 768–1023, desktop ≥ 1024, read from one shared layout signal (Build brief, Rules).
- D4 Viewport `width=device-width, initial-scale=1, viewport-fit=cover`; zoom never disabled (Build brief).
- D5 Manifest: name "MotorFix", icons 192 and 512 plus maskable, `display: standalone`, theme colours for dark and light, start URL `/` *(proposed)* (Build brief).
- D6 Angular service worker for the app shell; API answers never cached *(proposed)*; Web Push added by ST-196 (Build brief).

## Constraints

- C1 ST-196 extends this service worker: it shows notifications and opens the right screen on tap (ST-196 Build brief, Scope). The Angular service worker handles push display and notification clicks itself, so ST-196 builds on it without replacing it.
- C2 Each screen's own phone layout, bottom sheets and tab bars are other stories (Build brief, Out of scope).
- C3 Without service worker support the app works as a normal website (Build brief, States).
- C4 Reads and writes nothing on the server (Build brief, Data).

## Open

- None in the Build brief ("Open: None").

## Contradictions

- X1 The mock's results board uses 11 px tab labels and 11 px dial digits → D2 (12 px everywhere) wins; the tab bars themselves are built by the two bottom tab bar stories.
- X2 A manifest has one `theme_color`, the brief asks for theme colours for dark and light → the manifest carries the dark colour and the page carries one `theme-color` per colour scheme (plan decision).

## Proposed Clarifications

- P1 How is "text zoom at 200%" exercised in a test? (no browser automation exposes text-only zoom)
- P2 Which routes are "every route" for the 320 px check while the dashboards need a session?
- P3 What does the layout signal say on the server, where there is no width?
