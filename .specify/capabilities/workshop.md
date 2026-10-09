---
capability: workshop
updated: 2026-10-08
features:
  - 220-requests-quotes-bookings
---

# Capability: Workshop

The work in the garage for a confirmed booking: the job, its stages and the time each began, its steps, and the final price recorded at handover.

## Requirements

### 220-FR-007 — A JOB MUST store: booking, garage, car, driver, mechanic (optional), status ∈ `to_do`, `in_work`, `paused`, `done`, `cancelled`, `started_at`, `paused_at`, `finished_at`, `handed_over_at`, `eta_at` (optional), `final_price_bani` (optional, recorded at handover by a later story), `created_at`; one JOB per booking. A JOB_STEP MUST store: job, position, `label` (the garage's text, 1 to 120 characters), `customer_label` (optional, the words the driver sees, 1 to 120 characters), `done_at` (optional). A JOB_STAGE_ENTRY MUST store: job, from status (absent for the first), to status, actor (account, optional for `system`), `actor_role`, `text` (optional, the garage's own words for the driver, at most 500 characters), `at`, so the tracker of a later story shows when each stage began. Nothing in this story creates a job; it is created `to_do` by the confirmation story.

_From 220-requests-quotes-bookings._
