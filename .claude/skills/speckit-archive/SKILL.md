---
name: "speckit-archive"
description: "Close a finished feature: merge its Spec Delta into the living capability specs under .specify/capabilities/, so the repository states what the system does today rather than what seven features once proposed. Runs after /speckit-review, as the last step of a feature. Use when a feature is done, when a capability's requirements contradict each other, or when a retired requirement is still being demanded by the traceability gate."
argument-hint: "Optional: the feature directory to archive (defaults to the active feature)."
compatibility: "Node 18+. Writes only under .specify/capabilities/ and the feature's own spec.md."
metadata:
  author: "speckit-demo"
  source: "adapted from OpenSpec's propose → apply → archive cycle (openspec.dev)"
user-invocable: true
disable-model-invocation: false
model: sonnet
---

## User Input

```text
$ARGUMENTS
```

## Why this exists

`specs/NNN-*/spec.md` is a **proposal**. It is written once, before the code,
and never revised. After a dozen features nothing in the repository states the
current contract — 007, 010 and 012 each rewrote part of the crypto asset API's
behaviour, and reading what it does today means reading three frozen specs and
working out which one won.

OpenSpec's answer is two document classes, and this is the same split:

| `specs/<feature>/spec.md` | `.specify/capabilities/<slug>.md` |
| --- | --- |
| a proposal, frozen at the moment it was agreed | current truth, edited every time it changes |
| carries a `## Spec Delta` saying what it changes | carries the merged result |
| never rewritten after the fact | rewritten by every archive |

Archiving is what moves a decision from the first column to the second.

## Preconditions — check before anything else

Stop and say which one failed rather than working around it:

1. `tasks.md` has no unchecked task. An in-flight feature has nothing settled
   to merge.
2. `npm run typecheck && npm run lint && npm test` is green.
3. The feature has been reviewed (`/speckit-review`, or `spec-reviewer` +
   `code-reviewer` with no surviving CRITICAL/HIGH finding).
4. `node .claude/scripts/capabilities.mjs validate <feature> --check` exits 0.

## Phase 1 — read the delta the feature declares

```bash
node .claude/scripts/capabilities.mjs validate specs/<feature>
```

If the spec has no `## Spec Delta` block, write one now, before merging. It goes
after the requirements and before the success criteria:

```markdown
## Spec Delta

### Capability: `cli-tasks`

- **Adds**: FR-001–FR-005, FR-007
- **Modifies**: `001-FR-004` → `FR-006`, `001-FR-007` → `FR-008`
- **Removes**: `001-FR-009` — the directory is created on demand now
```

Three rules decide which list a requirement belongs in, and getting this wrong
is the whole failure mode the capability file exists to prevent:

- **Adds** — behaviour that did not exist. Names this feature's own ids.
- **Modifies** — behaviour that existed and now works differently. Names the
  requirement it replaces, feature-qualified (`001-FR-004`), and the id
  replacing it. A requirement that *contradicts* one already in the capability
  is a Modifies, never an Add; two contradictory statements in one capability
  is exactly the rot this closes.
- **Removes** — behaviour that is gone. Names the retired requirement and why.

`validate` refuses a `Modifies`/`Removes` whose base is not in the capability.
That check is deliberate: OpenSpec reports it as a bug in their own tooling
(Fission-AI/OpenSpec#1112) because they only run it at archive time, by which
point the merge is already half applied.

## Phase 2 — preview, then apply

```bash
node .claude/scripts/capabilities.mjs merge specs/<feature>            # dry run
node .claude/scripts/capabilities.mjs merge specs/<feature> --apply    # write
```

The dry run prints `+added ~modified -removed` per capability and writes
nothing. Read it before applying. If a count surprises you, the delta is wrong,
not the tool.

`--apply` checks every planned file against the delta before it writes any;
on a failure it prints each one, exits 1 and writes nothing. That means the
delta (or a capability already holding a token twice) is wrong: fix it there,
never the file by hand.

After applying, read `git diff -- .specify/capabilities/` and the counts
line, not the whole files.

## Phase 3 — check the diff

The diff shows one `### <NNN>-FR-<n> —` heading added per Adds and per
replacement, each Modifies and Removes base's heading gone, and one `## Retired`
tombstone per base; a requirement whose text no longer makes sense out of its
feature's context is fixed in `spec.md` and merged again. The tombstones are
how `.claude/scripts/trace-matrix.mjs` drops a requirement from the coverage
denominator, the **only honest way out of the traceability gate** (growing
`.specify/trace-baseline.json` is blocked by `pre:edit:config-protection`).

Check it landed:

```bash
node .claude/scripts/capabilities.mjs list
node .claude/scripts/trace-matrix.mjs
```

A retired requirement now prints `⊘ retired` instead of `✗ UNTESTED`.

## Phase 4 — close the feature

Steps 1–3 run before the feature's PR goes ready: the capability merge rides
in its own PR, the feature folder goes to the private specs repository
(AGENTS.md, lifecycle step 4); step
4 runs after the merge, by whoever merged it (under `/speckit-auto`, the
tail agent), and commit nothing.

1. Mark the feature's `spec.md` status line `Archived (<date>)`.
2. `/speckit-retro` is manual only in the `/speckit-auto` chain: an
   autonomous run does not invoke it. Run by hand, run it first if it has not
   run — the acceptance verdict belongs with the feature.
3. Stage `.specify/capabilities/` with the branch's last slice commit (or the
   next fix commit when that slice is already pushed), never a commit of its
   own, and push; commit
   the feature folder (status line, `tracker-sync.md` as it stands) to the specs
   repository: `node .claude/scripts/specs-repo.mjs commit "chore(specs): ST-<n> archive" -- <feature>`.
4. Invoke `speckit-tracker-sync finish` (from QA, after the PR tester passed and
   the PR merged): the story's issue goes to Done and closes, and the
   epic to Done once every story in it is Done. Skip this if the merge to
   `main` already ran it. Its log lines go into one comment on the merged PR,
   not a commit (`speckit-tracker-sync`, §5).

## What this never does

- It does not delete `specs/<feature>/`. The proposal and its reasoning stay
  readable; only the *claim to describe current behaviour* moves.
- It does not touch code or tests.
- It does not invent a capability. A delta naming one that has no file under
  `.specify/capabilities/` is an error, not a prompt to create it — a new
  capability is a deliberate act: copy `.specify/templates/capability-template.md`
  and say what it is, then archive into it.
