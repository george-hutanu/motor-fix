# Auto run — 610-dependabot-exemption

Level 1 (one-session). ST-610. Start commit 2070355 (origin/main).

- **Ownership**: no `610` branch, no `.worktrees/610-*`, watch.mjs listed no holder.
- **Size**: level 1 — classifier unsure ("and"); two LOW findings in two hooks, intent fully stated by the task, one session.
- **Notion**: ST-610 To do → Planning, Ready to work unticked; Foundations timeline row created (3f1607bff0d281fc9836ef1626b4e2ff) → Planning; EP-1 already In progress. Connector path (no NOTION_TOKEN).
- **Verify**: confirmed — `isDependabot` reads authors only (`pr-lifecycle-gate.mjs:74`); `gh pr view --json commits` has no committer; real Dependabot commit 46aaf57 (PR #99) is committer `web-flow`, verified `valid`.
- **Specify**: spec.md (FR-001–FR-003, Spec Delta), tasks.md (T001–T009). No screens (design.md).
- **Tests** (red first): vitest committer/unverified/missing cases and the red Dependabot wording failed before the change; eval case `merge-gate-refuses-a-dependabot-pr-committed-by-someone-else` added. Commit ac890f6.
- **Implement**: committer check in `isDependabot`, REST committer read in both gates (Dependabot PRs only), the exempt path's own red refusal. Commit 6b2ff0e. Fingerprints re-blessed after reading the diff.
- **Harden**: `npm run test:harness` 1495 passed; `harness-eval --check` 82/82; `doctor` 16 ok. Real check: PR #98 exempt, PR #99 not (owner's commits).
- **Review** (lap 1 of 5): spec-reviewer APPROVE (LOW #1 duplicate readers, patched; LOW #2 trace-matrix ignores `.claude` specs, deferred → https://app.notion.com/p/3f1607bff0d281169cc9d997b6da280e). code-reviewer APPROVE (MEDIUM #1 fold `readCommitters` into `withCommitters`, patched in 40ddc07; LOW #2 decision, taken on the owner's behalf: a failed committer read in the merge gate refuses with a retry, like a failed PR read, rather than sending the agent to a tester it may not need; spec FR-002 and scenario 4 updated).
- **Agent context**: skipped at level 1.
- **Retro evidence**: gathered (4 commits, no carried open items for this feature); verdict left to the owner.
- **Archive**: Spec Delta merged into `.specify/capabilities/platform.md` (+3); spec Archived (2026-10-06).

## Final Report

ST-610 is done on PR #150. Two gate changes: `isDependabot` now also requires every commit's committer to be `web-flow` or `dependabot[bot]` with a verified signature, read from the REST pulls commits API for Dependabot PRs only. A red exempt Dependabot PR now gets its own refusal, which points at `@dependabot rebase` / `recreate` or a PR of one's own, and no longer at the PR tester. Proof: harness 1495 passed, evals 82/82, doctor clean. Decision taken for the owner: a failed committer read refuses the merge with a retry. Deferred: trace-matrix does not count `.claude` specs (Notion task filed).
