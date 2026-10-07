# Implementation Plan: Adding the tester's findings twice adds them once

**Branch**: `446-add-findings-idempotent` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

## Summary

`addFindings` in `.claude/scripts/pr-test/post.mjs` appends the agent's findings to the report's without looking at what the report already holds. `post.mjs --add` writes the result back to report.json, so any second run over the same files (a retry after a failed status call, ST-446; the real post after `--dry-run`, ST-484) appends them again. Make the add skip a finding already present, compared by its JSON form. The write-back stays.

## Technical Context

- Language: Node ESM (`.mjs`), no build step; harness specs run on vitest (`.claude/vitest.config.ts`, `npm run test:harness`), not Jest.
- Touched: `.claude/scripts/pr-test/post.mjs` (`addFindings`, ~3 lines), `.claude/scripts/pr-test/post.spec.mjs` (one case).
- No dependency, contract, route or data change. No gate script is touched, so no `--bless-hooks`.

## Constitution Check

- I (no bloat): a `Set` of the present findings' JSON and a filter; no new option, no new file.
- II (tests first): the repeated-add case is written and seen red before the change.
- VII: draft PR #182, Notion linked.

## Design

```js
const held = new Set(report.findings.map((f) => JSON.stringify(f)));
const findings = [...report.findings, ...extra.filter((f) => !held.has(JSON.stringify(f)) && held.add(JSON.stringify(f)))];
```

`held.add` returns the Set (truthy), so a duplicate inside `extra` itself is also taken once. Key order is stable: the same `agent-findings.json` parses to the same order, and report.json round-trips it.

## Alternatives rejected

- Skip the write-back under `--dry-run`: fixes ST-484 only; a retry after a failed status call (ST-446) still doubles.
- Drop the write-back: report.json and report.md are what QA copies into `pr-review/`; they would lose the agent's findings.
