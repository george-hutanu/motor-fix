# Feature Specification: The PR tester starts from a packet and reviews only what changed

**Feature Branch**: `698-tester-packet`

**Created**: 2026-10-05

**Status**: Archived (2026-10-05)

**Story**: ST-698 (Tech debt, epic EP-1) — https://app.notion.com/p/3f0607bff0d281aa9841fd35636fd69d

**Input**: User description: "ST-698 The PR tester starts from a packet and reviews only what changed. The pr-tester is about 10% of all cost over 81 runs, all on Opus, and every run explores from scratch: the diff, the spec, the constitution, the whole report and screenshot set. Build: (0) measure first; (a) a packet script under `.claude/scripts/pr-test/` that hands the tester a small precomputed input: changed files and the diff stat, the FRs touched, report.json's failures and diffs, and the prior lap's findings; (b) a baseline delta: compare report.json and screenshots with the last tested commit (or main's last run) so a re-lap reviews only what changed (carry already covers documentation-only heads). The pr-tester stays on Opus and keeps the full constitution."

## Baseline (measured 2026-10-05, before any change)

Measured from the pr-tester subagent transcripts under
`~/.claude/projects/-Users-georgehutanu-projects-motor-fix/` (one transcript per
run, usage summed per assistant message). Weighted = input + cache read × 0.1 +
cache write × 1.25 + output × 5, the same weights the other session's
`cats.mjs` uses.

| Window | Runs | Median turns | Median tokens per run | Median weighted | Mean tokens per run |
| --- | --- | --- | --- | --- | --- |
| All pr-tester runs | 95 | 19 | 658,414 | 164,474 | 1,138,781 |
| Since QA moved to CI (2026-10-05 12:00) | 32 | 18 | 688,277 | 182,219 | 898,082 |

Turns by activity, all 2,122 pr-tester turns (`cats.mjs pr-tester`): reading
files through the shell 17.5% of turns / 20.2% of cost, `gh pr` calls 13.9% /
15.9%, CI and run polling 12.7% / 12.8%, harness scripts 13.7% / 12.1%, git
11.0% / 11.0%, other shell 11.2% / 10.4%, screenshots 4.8% / 4.5%, rules files
(constitution, skills, AGENTS.md) 3.0% / 2.7%. Most turns go to assembling the
inputs (the PR, its files and diff stat, the spec and tasks, the report, the
screenshot list, the previous lap), not to judging them; reading the rules is
under 3% of cost, so keeping the full constitution costs little.

## Measurement (after, 2026-10-05)

Replay of PR #137 (harness-only, head `b255ff1`) on the same finished run
37326786521, lap 2, dry run, Opus, same weights as the Baseline. Each line is
one transcript under `565e5c5f-…/subagents/`.

| Run | Transcript | Turns | Tokens | Weighted | Verdict |
| --- | --- | --- | --- | --- | --- |
| The real lap (recorded) | a12fd20b9713ddf41 | 18 | 589,100 | 179,737 | success |
| Old instructions (main), replay | a2e3ea570a207207c | 12 | 1,004,144 | 203,803 | success |
| New, first packet (every changed screenshot named) | a73a568a871f4db70 | 12 | 1,003,348 | 252,396 | success |
| New, a no-web change names only cited screenshots | ab937b48d68830784 | 16 | 1,375,792 | 249,500 | success |

Result: on this PR the packet saved no tokens. The new tester costs about 22%
more weighted than the old replay. All three replays and the recorded lap
reached `success` with no blocking finding, so the verdict holds (SC-002).
SC-001 is reported as measured, with no drop. The first replay showed that a
harness-only PR still had 17 of 32 screenshots differ from the baseline. That
is run-time noise, so the packet named all of them. The fix lets a change with
no web file name only the screenshots a finding cites. The second replay
opened no screenshot (the old one opened one), but it took more turns. On a PR
like this the cost is cumulative cache reads per turn. Most of that comes from
reading the diff and the spec, which the tester still does in full, and less
from the inputs the packet precomputes. One replay per arm is a small sample:
turn counts vary by 4 between the two runs of the same instructions. Whether
the packet pays off on a web PR's re-lap with failing flows, where the
screenshot and report delta matters, is not measured here (deferred.md).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The tester starts from one precomputed packet (Priority: P1)

The PR tester (an Opus subagent) has downloaded the PR QA run's artifact. One
script call writes a packet beside it: the PR, the changed files with their
line counts, the requirements those files implement, the run's verdict,
blocking findings and notes, and the previous lap's findings. The tester reads
that one file instead of assembling the same facts over a dozen calls, then
reviews the diff and the constitution as before.

**Why this priority**: the assembly turns are most of the tester's cost; this
removes them without touching the judgement.

**Independent Test**: run the script against a finished run's artifact folder
with a stubbed `gh`; the packet lists exactly the PR's files, the FRs whose
tasks name those files, and every blocking finding of the report.

**Acceptance Scenarios**:

1. **Given** a downloaded artifact with `report.json` and a PR whose files are
   known, **When** the packet script runs, **Then** it writes `packet.md` in
   the same folder with the PR header, one line per changed file with its
   additions and deletions and the totals, and the run's verdict and summary.
2. **Given** a feature whose `tasks.md` names a changed file on a line tagged
   with FR ids, **When** the packet is built, **Then** those FR ids are listed
   with their requirement text from `spec.md`.
3. **Given** a report with blocking findings, **When** the packet is built,
   **Then** every blocker and high finding is listed with its severity, title,
   where and evidence, whatever the packet's length.

### User Story 2 - A re-lap reviews only what changed since the last tested commit (Priority: P2)

On lap 2 or later, or on a first lap of a PR when an earlier tested state of
`main` exists, the packet compares the run with a baseline run: which findings
are new, which persist, which were resolved, and which screenshots differ.
The tester looks at the screenshots that changed and those a finding cites,
not every screenshot of the sweep.

**Why this priority**: the screenshot set is 32 images per two routes; most
are byte-identical between laps of a harness-only or API-only change.

**Independent Test**: two artifact folders with overlapping findings and
screenshots; the packet's delta names the new, persisting and resolved
findings and the changed, new and removed screenshots exactly.

**Acceptance Scenarios**:

1. **Given** a baseline run of the same PR at an earlier head, **When** the
   packet is built, **Then** it compares against that run and says which.
2. **Given** no earlier run of the PR, **When** the packet is built, **Then**
   it compares against the newest finished run whose tested commit is already
   on the PR's base branch, and says which.
3. **Given** no usable baseline (none found, or its artifact expired or failed
   to download), **When** the packet is built, **Then** it says so with the
   reason and tells the tester to review every screenshot.
4. **Given** a change that touches no web file, **When** the packet lists what
   to look at, **Then** it names only the screenshots a finding cites, still
   counting what differs, because such a change cannot be what moved a screen
   (with or without a baseline).
5. **Given** a screenshot that is unchanged from the baseline but cited as a
   finding's evidence, **When** the packet lists what to look at, **Then** it
   is listed.

### User Story 3 - The tester and the skill use the packet, and nothing else about QA changes (Priority: P3)

`pr-tester.md` and the `speckit-pr-test` skill tell the tester to build and
read the packet first; the verdict rules, the merge gate, its evals and the
carry are untouched.

**Independent Test**: a replayed PR's finished run, reviewed in dry-run by the
old instructions and by the new ones, gets the same verdict; the new review
uses fewer tokens, measured from both transcripts.

**Acceptance Scenarios**:

1. **Given** the new instructions, **When** the tester reviews a finished run,
   **Then** it builds the packet before reading the report, the screenshots or
   the spec.
2. **Given** the same finished run, **When** reviewed by the old and by the new
   instructions, **Then** both verdicts are equal.

### Edge Cases

- `report.json` missing in the folder: the script exits 2 and writes nothing;
  the tester posts the missing-report failure exactly as today.
- `gh` fails while reading the PR or listing runs: the packet is still written
  with the report's sections and the failed section marked unavailable with
  the reason; the script exits 0.
- A PR without a feature directory (`specs/<branch>/`), or a `tasks.md` naming
  no changed file: the FR section says so; the tester reads the spec itself.
- Hundreds of changed files: the file list is capped and the remainder counted;
  the totals stay exact.
- The baseline run is the run under review (same id or same head): it is
  skipped.
- Screenshots present in one run and not the other (a new route): listed as new
  or removed, never as unchanged.

## Clarifications

### Session 2026-10-05

- Q: Where does the packet get the previous lap's tester findings, which the artifact does not hold? → A: From `specs/<feature>/pr-review/lap<n>/report.json` at the PR head, which a failing lap commits with its fix after `post.mjs` folded the tester's findings in; else the baseline artifact's report, marked as the workflow's findings only. (autonomous default)
- Q: Which runs count as a baseline candidate, and newest by what? → A: Conclusion success or failure, created before the run under review, artifact downloaded with a `report.json`; others are skipped. (autonomous default)
- Q: Source of the changed files, and the cap? → A: `gh pr view --json files` (one call, already per-file additions and deletions); cap 100 files. (autonomous default)
- Q: How does a `tasks.md` line name a file, and are FR ranges expanded? → A: The line contains the repo-relative path; `FR-a–FR-b` expands to every id; files are read at the PR head through the contents API. (autonomous default)
- Q: How is the "old instructions" replay run, and what drop passes? → A: The old run is the pr-tester's real lap transcript on the replayed PR (same finished run), or `main`'s `pr-tester.md` in dry-run; the result is reported as measured numbers with both transcript ids, with no threshold. (autonomous default)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A packet script under `.claude/scripts/pr-test/` MUST write
  `packet.md` into a given artifact folder holding `report.json`, containing:
  the PR number, title, branch, head and base; one line per changed file with
  additions and deletions (from `gh pr view --json files`), capped at 100
  files with the rest counted, and exact totals; the report's verdict, summary and notes; and
  every blocker and high finding with severity, title, where and evidence,
  plus the medium and low findings by title.
- **FR-002**: The packet MUST list the FR ids touched by the change: the FR ids
  on the `tasks.md` lines that name a changed file's path, each with its text
  from `spec.md`, both read at the PR's head through the GitHub contents API;
  a line names a file when it contains the file's repo-relative path, and an
  id range `FR-a–FR-b` counts as every id in it; when the feature directory or
  either file is missing, or no task names a changed file, the section says
  which.
- **FR-003**: The packet MUST include the previous lap's findings, each marked
  new, persisting or resolved against the current report by the key
  `mergeFindings` already uses (`kind|title|route`). The source is the newest
  `specs/<feature>/pr-review/lap<n>/report.json` at the PR's head (a failing
  lap's report, committed with its fix, holding the tester's findings
  `post.mjs` folded in); when there is none, the baseline run's own
  `report.json` (the workflow's findings only, which the packet says) if that
  run tested this same PR; another PR's run never gives the previous lap.
- **FR-004**: The script MUST choose the baseline run as: an explicit
  baseline (a run id or a folder) when given; otherwise the newest finished
  PR QA run of the same PR at a different head than the one under review;
  otherwise the newest finished PR QA run whose tested commit is an ancestor
  of the PR's base branch; otherwise none. A finished run is one with
  conclusion `success` or `failure`, created before the run under review,
  whose artifact downloads with a `report.json`; any other candidate is
  skipped. It MUST name the chosen run (id,
  PR, commit, lap) or the reason there is none.
- **FR-005**: The packet MUST compare the screenshots of the run with the
  baseline's by content hash and list, per file name, the changed, new and
  removed screenshots, with the unchanged ones counted; it MUST name, as the
  screenshots to look at, the changed and new ones plus every screenshot a
  current finding cites, and every screenshot when there is no baseline;
  when none of the PR's changed files is a web file (the prefixes
  `findings.mjs`'s `touchesWeb` uses), it MUST name only the cited ones.
  Only image files count as screenshots.
- **FR-006**: The script MUST exit 2, writing nothing, when the folder has no
  `report.json`; a failing `gh` call or baseline download MUST NOT fail it:
  the affected section is marked unavailable with the reason and the script
  exits 0.
- **FR-007**: `.claude/agents/pr-tester.md` MUST tell the tester to build the
  packet right after the run's artifact is in its folder and, in the review,
  to read it before the report, the screenshots, the spec or the diff (the
  spec's first read, to list the flows, comes before the run); to open only the
  screenshots the packet names; and MUST keep `model: opus`, the full
  constitution review, the verdict rules and `post.mjs` posting unchanged.
- **FR-008**: `.claude/skills/speckit-pr-test/SKILL.md` MUST describe the
  packet step in its Test step.
- **FR-009**: The merge gate, its eval cases and `carry.mjs` MUST keep their
  behaviour: `merge-gate.mjs`, `.claude/evals/cases/merge-gate.json` and
  `carry.mjs` are not changed by this feature.

### Key Entities

- **Packet**: one Markdown file per lap in the run's artifact folder; the
  tester's first input. Not committed.
- **Baseline run**: the earlier PR QA run whose report and screenshots the
  current run is compared with.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a replayed real PR's finished run, the tokens per run of the
  tester following the new instructions and of the one following the old ones
  are measured from their transcripts (total tokens and weighted), never
  estimated, and reported whatever they show. A drop is the aim, not a
  threshold (Clarifications). The one replay so far showed none; a web PR's
  re-lap is still to be measured (deferred.md).
- **SC-002**: Both replays reach the same verdict, and it equals the
  `agent-review` the PR's head received.
- **SC-003**: `npm run test:harness`, `node .claude/scripts/harness-eval.mjs
  --check` and `node .claude/scripts/doctor.mjs` pass; `merge-gate.mjs`, its
  eval cases and `carry.mjs` are byte-identical to `main`.

## Assumptions

- The replay target is PR #137 (open, harness-only, head `b255ff1` with a real
  `agent-review` success from PR QA run 37326786521, lap 2; lap 1 ran as
  37325724939 at `ae8db89`), reviewed in dry-run so nothing is posted
  (autonomous default: the newest open PR whose head carries a verdict from a
  real lap, not a carry).
- Screenshots are compared by SHA-256 of the file bytes, not pixel by pixel:
  the same Chromium on the same runner image renders an unchanged page to the
  same bytes, and no image dependency is added (Principle I). A false "changed"
  costs one extra look, never a missed one (autonomous default).
- The baseline's artifact is downloaded with `gh run download`, the way
  `dispatch.mjs` reads a run; artifacts are kept 7 days
  (`.github/workflows/pr-qa.yml`), so an older baseline is "none".
- The packet is written beside the report in the lap's `--out` folder and is
  never committed, like the screenshots (autonomous default).
- This feature builds on PR #140 (ST-688), which changes the same files; it is
  merged in before the code changes.

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001-FR-009
