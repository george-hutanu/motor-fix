---
capability: garage-brands
updated: 2026-10-07
features:
  - 039-brand-catalogue
---

# Capability: Garage brands

What a garage says about each brand: its stance (works on it or does not take it, unstated when nothing is said), the fuel ticks and the jobs on a brand it works on, its brand note and refusal phrase, and the one read function that gives its answer for a brand.

## Requirements

### 039-FR-013 — For each garage and brand the system MUST store at most one row, whose stance is one of `works_on` and `does_not_take`; a garage with no row for a brand has the answer `unstated`.

_From 039-brand-catalogue._

### 039-FR-014 — A `works_on` row MUST carry four fuel ticks (petrol, diesel, hybrid, electric), all true when the row is created; a `does_not_take` row MUST carry no fuel ticks, and ticking one on it MUST be refused; turning a `works_on` row into `does_not_take` clears its fuel ticks and deletes its job rows in the same write.

_From 039-brand-catalogue._

### 039-FR-015 — A garage MUST be able to hold one row per job type (a `job_type_id`, no foreign key until the job catalogue exists) it does for a brand, only for a brand with a `works_on` row; a job row for any other brand MUST be refused.

_From 039-brand-catalogue._

### 039-FR-016 — A garage MUST be able to hold an optional brand note of up to 140 characters and an optional refusal phrase of up to 60 characters; longer text MUST be refused.

_From 039-brand-catalogue._

### 039-FR-017 — One read function MUST give a garage's answer for a brand: `works_on`, `does_not_take` or `unstated`.

_From 039-brand-catalogue._
