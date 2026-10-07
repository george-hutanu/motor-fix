# Deferred findings: 108-step-list-in-view

- [ ] `apps/web/src/app/public/list-your-garage.ts:173` — **low** — new code, not urgent: `follow()` reads `getComputedStyle` on the bar and queries the six headings on every scroll and resize event, without coalescing; harmless with six empty sections, worth a `matchMedia('(min-width: 768px)')` read once the sections fill (code-reviewer, 2026-10-07) — Notion: https://app.notion.com/p/Tech-debt-ST-108-new-code-not-urgent-follow-reads-getComputedStyle-on-the-bar-and-queries-the-3f2607bff0d28189b38ec3c946bf7e0e
