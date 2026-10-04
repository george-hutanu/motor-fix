# CLAUDE.local.md — spec-kit workflow & gates

The spec-driven workflow and the gates that enforce it, installed from the
speckit-demo harness. Repo-wide rules — identity first — are in AGENTS.md.

## Spec-kit workflow

Specs live under `specs/<NNN-feature-slug>/`. Spec Kit is at **1.0.5**
(`.specify/init-options.json`), claude integration, Python helper scripts
(`.specify/scripts/python/`). Standard order:

```
/speckit-constitution → /speckit-specify → /speckit-clarify → /speckit-plan
/speckit-checklist    → /speckit-tasks   → /speckit-analyze → /speckit-tests
/speckit-implement    → /speckit-harden  → /speckit-review  → /speckit-retro
/speckit-archive
```

`/speckit-size` routes before `/speckit-specify`; `/speckit-correct-course`
handles an intent that changes mid-flight.

`/speckit-auto "<feature description>"` runs the whole chain end-to-end in one
turn, answering every interactive gate itself. It commits and pushes one
Conventional Commit per slice to the feature's draft PR, stops only on the Hard
Stops in `.claude/skills/speckit-auto/SKILL.md`, and logs to `auto-run.md`.

`/speckit-context` reads only the Notion space "MotorFix — Product
documentation" (story, feature page, epic, architecture, open decisions) — no
recency window, and when sources disagree the latest one wins.

Other entry points: `/speckit-assess-*` for raw ideas that aren't ready for a
spec, `/speckit-bug-{assess,fix,test}` for bug reports, `/speckit-converge` to
diff the codebase against a feature's artifacts and append the unbuilt work to
`tasks.md`.

Branches use the generated `NNN-slug` form. Every gate resolves the active
feature through `.specify/feature.json` (`.claude/scripts/lib/feature.mjs`).

## Gates

Constitution v1.1.0 (`.specify/memory/constitution.md`) maps each rule to its
check; its Enforcement section is the authority. In short:

| Gate | When | What it does |
| --- | --- | --- |
| `github-identity.sh` | at session start | exports `GH_TOKEN` for george-hutanu so `gh` never acts as the QLOG account; reports git identity drift or a missing gh login |
| `red-first-gate.mjs` | before an Edit/Write | blocks `apps/*/src`, `libs/*/src` edits while the active feature has FRs + open tasks but the branch touches no `*.spec.*`/`*.test.*` file — run `/speckit-tests` first |
| `post-edit-check.sh` | after an Edit/Write | `biome check` on the file, then its colocated `*.spec.ts` through Jest |
| `stop-test-gate.sh` | before the agent finishes | `biome check` + `jest --onlyChanged` must be green |
| `pre-commit-check.sh` | before `git commit` | commit-message policy, `spec-drift --staged` |
| `bash-guard.mjs` | before any Bash call | blocks force-push, pushes to `main`, `reset --hard`, `clean -f`, deleting `.work/` |
| `config-protection.mjs` | before an Edit/Write | the ratchets: a `thresholds.break` only rises, `.specify/trace-baseline.json` only shrinks, this file never grows past its baseline |
| `agent-model-router.mjs` | before an Agent call | routes `code-reviewer`/`spec-reviewer` to sonnet or fable by diff size; rewrites `model` or does nothing, never refuses (`SPECKIT_MODEL_ROUTER=0` to stop it) |
| `session-context.mjs` | at session start | injects `.specify/contexts/<mode>.md` for the phase the feature is in, plus instincts above the confidence threshold |
| `session-telemetry.mjs` | before the agent finishes | counts-only ledger per session in `.specify/telemetry/` |
| `.husky/pre-commit` | every real commit | identity check, then `typecheck` + `lint` + `test` |

The edit-time gates watch `apps/*`, `libs/*`, `e2e/` and skip Biome or Jest
until that tool is installed. The harness's own specs run on vitest, apart.

Every gate is registered in `.claude/hooks/registry.json` with an id and the
fingerprint of the script as reviewed; `.claude/settings.json` only calls
`run-hook.mjs <id>`. A gate can be disabled by id
(`SPECKIT_DISABLED_HOOKS=pre:bash:guard`) or by profile
(`SPECKIT_HOOK_PROFILE=off|standard|strict`), watched without blocking
(`SPECKIT_HOOKS_DRY_RUN=1`), and **editing a gate script fails
`node .claude/scripts/doctor.mjs` until you run `--bless-hooks`**. Read the
diff before blessing. `strict` also freezes `.claude/` against edits unless
`SPECKIT_ALLOW_HOOK_EDIT=1`.

## Commands

```
node .claude/scripts/trace-matrix.mjs            # FR → test matrix
node .claude/scripts/spec-drift.mjs --status     # drift baseline for the active feature
node .claude/scripts/lib/feature.mjs             # which feature the gates think is active
node .claude/scripts/artifact-lint.mjs           # spec/tasks defects (+ the Jev lane; --check drops it)
node .claude/scripts/diff-audit.mjs              # dead exports, import traps (+ the Jev lane)
node .claude/scripts/doctor.mjs                  # do the gates still fire? (--bless-hooks to re-record)
node .claude/scripts/config-scan.mjs             # unsafe patterns in the harness's own config
node .claude/scripts/harness-eval.mjs            # prove each gate blocks and passes (--check against .claude/evals/baseline.json)
node .claude/scripts/telemetry.mjs --unused      # which skills and subagents never fired
node .claude/scripts/instincts.mjs list          # learned behaviours and their confidence
node .claude/scripts/gc-scan.mjs                 # what has stopped earning its place
node .claude/scripts/status.mjs                  # every feature's state, risk flags and next action
node .claude/scripts/capabilities.mjs list       # the living capability specs
node .claude/scripts/capabilities.mjs validate   # does the active feature's Spec Delta merge cleanly?
node .claude/scripts/level.mjs                   # how much process this change gets (0-3)
node .claude/scripts/impact.mjs FR-004           # what rests on a requirement before you change it
node .claude/scripts/retro-evidence.mjs          # evidence for a feature retrospective
node .claude/scripts/run-state.mjs               # where an unattended run stands
node .claude/scripts/context-audit.mjs           # whether this file still earns every line
node .claude/scripts/jev.mjs check               # is the Jev lane reachable
npm run test:harness                             # the harness's own specs
```

## Memory across features, and right-sizing

- **Living capability specs.** `specs/NNN-*/spec.md` is a proposal, frozen when
  agreed; `.specify/capabilities/<slug>.md` is what the system does today. Each
  feature carries a `## Spec Delta` (Adds, Modifies, Removes) and
  `/speckit-archive` merges it. Retiring a requirement there is the honest way
  out of the coverage gate — nobody grows `.specify/trace-baseline.json`.
- **Scale levels.** `/speckit-size` records 0 trivial / 1 one-session /
  2 feature / 3 project in `.specify/feature.json`. A level chooses which
  artifacts a change owes — never whether its tests come first.
- **Retrospectives with a verdict.** `/speckit-retro` records `accepted`,
  `accepted-with-open-items` or `rejected`; open action items carry forward.
- **A defer route for reviews.** A verified finding that is real but not this
  change lands in `specs/<feature>/deferred.md` instead of scope creep.
- **Machine-readable run state.** `.specify/run-state.json` carries `status`,
  `blocking_condition` and `repair_iterations`; a fix/re-verify loop blocks at
  five laps (`SPECKIT_MAX_REPAIR_ITERATIONS`).
- **A context ratchet.** This file may shrink freely and may not grow past
  `.specify/context-baseline.json`. Record deliberate growth with
  `node .claude/scripts/context-audit.mjs --bless --allow-growth "<reason>"`.
- **Two thinking commands.** `/speckit-elicit` re-reads an artifact through
  named reasoning methods; `/speckit-roundtable` argues a decision from four
  positions and records the disagreement.

## The Jev lane

An advisory second lane over the same scripts for non-mechanical judgements
(is this requirement testable, does this context line still change behaviour).
It is [Jev](https://docs.typesafe.ai), reached by `fetch` in
`.claude/scripts/lib/jev.mjs`, keyed by `TYPESAFE_API_KEY` or `JEV` in `.env`.
It never reaches an exit code, fails open (no key → one line saying the lane
was unavailable), and never runs per-edit. Off with `SPECKIT_JEV=0`, or per
run with `--no-jev`; `--check` runs drop it.

## Maintaining the harness

- `/speckit-doctor` — checks the gates still fire and repairs only what you name.
- `/speckit-learn` — records approved instincts into `.specify/memory/instincts/`;
  they decay without reinforcement. An instinct suggests; only a gate enforces.
- `/speckit-evolve` — promotes a cluster of instincts into a gate, skill or
  constitution line.
- `/speckit-config-gc` — sweeps unused skills, agents, hooks and stale state,
  one approval at a time, into `.specify/_gc_trash/`.

`.claude/evals/cases/*.json` feed payloads through `run-hook.mjs` and assert
exit codes — the layer that notices a gate that silently stopped firing.
`pass_rate` in `.claude/evals/baseline.json` only rises.

`npm test` runs the harness specs until product tests exist; run them after
touching a gate, and before `--bless-hooks`. `.claude/vitest.config.ts` pins
`root` to `.claude/` so `.worktrees/*` copies are not collected twice.

Commit style: one-line Conventional Commit with a scope (`feat(api): …`), no
body, no trailers, no tool mentions — enforced by
`.claude/hooks/commit-msg-policy.js`. Every task runs the lifecycle in AGENTS.md:
In progress, draft PR, a push per commit (never forced, never `main`), PR ready
plus In review when done, merge on green CI, then Done. Nothing waits for the user.

## Design work

`apple-design-skill` (a local mirror of Apple's HIG) and `/design-audit` (a
ranked, read-only UI audit with `scan.mjs` and `contrast.mjs` helpers; fixes
only the findings you name).

<!-- SPECKIT START -->
Active plan (stack, structure, commands): specs/016-i18n-runtime/plan.md
<!-- SPECKIT END -->
