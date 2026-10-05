# Tasks: The live toast passes axe and is still announced

**Input**: `specs/582-live-toast-axe/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [X] T001 [US1] Test: `libs/ui-cockpit/src/lib/helm/toaster.spec.ts` (new) — with toasts shown (one, then a second added, one important), axe-core reports no violation in `hlm-toaster`; the `ol` is a list whose toasts are its items; each toast `li` has `aria-live` polite/assertive, `aria-atomic="true"`, no `role` (FR-001–FR-004)
- [X] T002 [US1] Test: `apps/web-e2e/src/toast.spec.ts` (new) — the /cockpit sample toast passes axe and is a polite live region, dark/light × ro/en (FR-001, FR-002)
- [X] T003 [US1] Test: `apps/web-e2e/src/toast.spec.ts` — a dashboard toast (the e-mail banner's "send again"; the live test update shows on the status line, not as a toast) passes axe at 320, 390, tablet and desktop, light and dark (FR-001, SC-001)

## Phase 2: Implementation

- [X] T004 [US1] `libs/ui-cockpit/src/lib/helm/toaster.ts`: after render in the browser, a MutationObserver on the host sets `role="list"` on `ol[data-sonner-toaster]`, `role="none"` on `brn-sonner-toast`, and removes `role` from `li[data-sonner-toast]`; disconnected on destroy (FR-001–FR-004)

## Phase 3: Proof

- [X] T005 `npx nx test ui-cockpit`, Playwright `toast.spec.ts`, typecheck and lint green

## FR → test

| FR | Proof |
|---|---|
| FR-001 | `toaster.spec.ts` (axe in jsdom), `toast.spec.ts` (cockpit toast axe, 2 schemes × 2 languages; dashboard toast axe, 4 viewports × 2 schemes) |
| FR-002 | `toaster.spec.ts` (aria-live polite/assertive, aria-atomic), `toast.spec.ts` (aria-live and aria-atomic on the shown toast) |
| FR-003 | `toaster.spec.ts` (ol role list, wrappers role none, li items) |
| FR-004 | `toaster.spec.ts` (a second toast added while the first shows) |
