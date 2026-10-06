# Deferred — 582-live-toast-axe

- [ ] `libs/ui-cockpit/src/lib/helm/toaster.ts` — **low** — `afterNextRender` attaches the MutationObserver but never calls `fixRoles(host)` once itself, so a toast drawn in the toaster's first render keeps `role="status"` until the stack next changes (pr-tester lap 1 #2, 2026-10-05) — Notion: https://app.notion.com/p/3f0607bff0d281b687ccc5911bede8b1
- [ ] `/app/driver` — **medium** — the PR QA sweep cannot reach the dashboard toast: its browser stubs never get past the sign-in dialog, so only CI's `toast.spec.ts` covers that toast; the QA flows need a signed-in session for guarded routes (pr-tester lap 1 #1, 2026-10-05) — Notion: https://app.notion.com/p/3f0607bff0d281dc909edde62e7b3fc1
