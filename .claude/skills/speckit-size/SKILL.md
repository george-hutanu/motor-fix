---
name: "speckit-size"
description: "Route a piece of work to the amount of process it actually needs — trivial, one-session, feature, or project — and record the choice so the gates and /speckit-auto read it instead of assuming. Run it before /speckit-specify, or when a full spec cycle feels like paperwork for a small change."
argument-hint: "The work, in a sentence. Or nothing, to report the level already chosen."
compatibility: "Node 18+. Writes only the `level` field of .specify/feature.json."
metadata:
  author: "speckit-demo"
  source: "adapted from BMAD's scale-adaptive routing (docs.bmad-method.org/plan/choose-a-planning-path)"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

## Why this exists

This repository had one size. `/speckit-auto` runs fourteen phases whether the
work is a new subsystem or a renamed variable: constitution check, specify, org
context, clarify, plan, checklist, tasks, analyze, tests, implement, converge,
harden, review, context refresh. The only escapes were the bug-triage cycle and
the pre-spec assess pipeline, and neither covers "this is a small, clear
change."

BMAD routes on a single question, and it is the right one:

> **Is the intent already well defined?** — meaning it says what should be true
> when the work is done, what must not change, and what is out of scope,
> completely enough that someone else could build it without guessing.

## Phase 1 — ask the question

Answer it about the work in `$ARGUMENTS`, out loud, in one or two sentences. If
you cannot say what "done" means without inventing a requirement, the intent is
not defined and the answer is at least level 2 regardless of how small the diff
looks.

Then pick:

| Level | Name | When | Owes | Phases |
| --- | --- | --- | --- | --- |
| 0 | trivial | obvious, low-risk, reversible: a typo, a message, a rename | nothing | edit, verify |
| 1 | one-session | one coherent unit, intent already clear | `spec.md`, `tasks.md` | specify → tests → implement → review |
| 2 | feature | the default: intent needs settling, design has choices | `spec.md`, `plan.md`, `tasks.md` | the full chain |
| 3 | project | several features that must not diverge | level 2, plus a brief they share | the full chain, per feature, against one brief |

Two rules that decide most cases:

- **Size of the intent, not size of the diff.** A one-line change to what
  `--json` emits is a contract change; a 400-line mechanical rename is not.
- **Level 3 earns its brief the way BMAD earns a PRD**: "when more than one
  person must agree on what the product is, or more than one epic must not
  diverge; otherwise skip it."

## Phase 2 — record it

```bash
node .claude/scripts/level.mjs suggest "<what the work is>"   # a typed opinion first
node .claude/scripts/level.mjs set <0-3>
node .claude/scripts/level.mjs            # read it back, with the source it came from
```

For one command without touching the file: `SPECKIT_FEATURE_LEVEL=1 <command>`.

## Phase 3 — say what it changed

Report the level, and the phases it skips. Be concrete: "level 1 — no plan.md,
no research.md, no contracts/; `/speckit-tests` still runs first."

## What a level never does

It chooses **how much planning** a change carries. It does not choose whether
the change is tested:

- `pre:edit:red-first` reads the spec and the tasks, never the level. A feature
  with FRs and open tasks still cannot touch `apps/*/src` or `libs/*/src` until tagged
  failing tests exist.
- The spec-drift check still requires a `feat`/`fix`/`perf` commit touching
  `apps/*/src` or `libs/*/src` to stage `specs/` too.
- `node .claude/scripts/trace-matrix.mjs --check` still fails on an implemented feature with untested
  requirements.

That is deliberate. If the level could turn those off, setting it to 0 would be
the cheapest way out of every gate, and this would be a hole rather than a
router. Weakening a gate has to look like weakening a gate — the ratchets in
`pre:edit:config-protection` exist for exactly that reason.

`artifact-lint` is the one check that reads the level, and only to stop asking
for artifacts the level does not owe: no `plan-missing` at levels 0 and 1.
