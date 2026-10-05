# Deferred findings: 612-live-status-spacing

Findings a review verified but deliberately did not act on in this feature.

- [ ] `apps/web/src/app/dashboard/frame.ts:90` — **low** — pre-existing: the offline bar (`.live-offline`, ST-255) has no top margin, so its top border sits flush under the header and the RO/EN switch, the same contact ST-612 removed for the status line; ST-612 was scoped to `.live-status` (design check, 2026-10-05) — Notion: https://app.notion.com/p/3f0607bff0d2816bb941df4c46810caa
