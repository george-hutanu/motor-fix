**Agent review: failure** — PR #42 at `b806e99`, lap 2

Blocking: 15 (blocker 0, high 15) · medium 5 · low 4. Booted: postgres, redis, api, web.
- No Docker on this machine: private PostgreSQL and Redis on free ports, no object store.
- No changed GET endpoint without path parameters.

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | high | decide exits 0 with JSON |  | exit 0:   |
| 2 | high | decide refuses invalid JSON with exit 2 and a message |  | exit 0; stdout ""; stderr "" |
| 3 | high | decide refuses an object, not an array with exit 2 and a message |  | exit 0; stdout ""; stderr "" |
| 4 | high | decide refuses an item without id with exit 2 and a message |  | exit 0; stdout ""; stderr "" |
| 5 | high | decide refuses empty stdin with exit 2 and a message |  | exit 0; stdout ""; stderr "" |
| 6 | high | decide on [] prints empty lists |  |  |
| 7 | high | check on 490 notion-sync.md (not finished) exits 1 naming the finish step |  | exit 0:  |
| 8 | high | check: finish without ready → exit 1 |  | exit 0;  |
| 9 | high | check: ready only before finish → exit 1 |  | exit 0;  |
| 10 | high | check: PENDING comment does not count → exit 1 |  | exit 0;  |
| 11 | high | check: re-finished: ready only after the first finish → exit 1 |  | exit 0;  |
| 12 | high | check: no finish line → exit 1 |  | exit 0;  |
| 13 | high | check: empty file → exit 1 |  | exit 0;  |
| 14 | high | npm run test:harness passes at the PR head |  |      × does not run the lane under --check 5828ms /      × accepts --no-jev without changing the mechanical findings 5630ms /  Test Files  1 failed \| 38 passed (39) /       Tests  2 failed \| 825 passed (827) / ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯ /  FAIL  \|harness\| scripts/artifact-lint.spec.mjs > diff-audit — the same default > does not run the lane under --check /  FAIL  \|harness\| scripts/artifact-lint.spec.mjs > diff-audit — the same default > accepts --no-jev without changing the mechanical findings |
| 15 | high | notion-ready.mjs does nothing and exits 0 when run through a symlinked path, so the archive check fails open (FR-007, SC-002) |  | `if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(run(...))`: Node resolves symlinks for import.meta.url but process.argv[1] keeps the path as typed, so main never runs and the process exits 0. In the PR tester's own worktree (/var/folders/... -> /private/var/folders/...) every CLI call returned exit 0 with empty stdout and stderr: these are report findings 'decide exits 0 with JSON' through 'no command prints usage', 13 symptoms of this one cause. A gate whose job is to refuse an archive passes silently. watch.mjs:446 already has the safe form: `realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))`. Add a CLI test that runs the script through a symlink. Standalone, at the real path, all 29 CLI checks pass. |
| 16 | medium | api readiness: storage down |  |  |
| 17 | medium | decide dedupes a repeated id |  | exit 0; stdout ""; stderr "" |
| 18 | medium | check on a missing file exits 2 with a message |  | exit 0:  |
| 19 | medium | check without a file prints usage, exit 2 |  | exit 0:  |
| 20 | medium | PR description contradicts the diff on watch.adversary.spec.mjs |  | The body says `watch.adversary.spec.mjs` 'fails a different single test per full run under load ... It is untouched here, so this is pre-existing flakiness', but b806e99 changes line 1443 (`env({ now: Date.now() })` -> `env()`), and auto-run.md calls the failure a time bomb, not flakiness. 'What changed' does not list the file. The fix itself is correct: the claim is written with NOW and must be read with NOW. |
| 21 | low | no command prints usage, exit 2 |  | exit 0:  |
| 22 | low | decide output over 64 KB is truncated on macOS pipes while the exit code stays 0 |  | 20 of 20 runs: stdout cut at exactly 65536 bytes, invalid JSON, exit 0. `console.log` followed by `process.exit()` drops what is still buffered, because macOS pipe writes are asynchronous. Real epics are far below that size, so this only bites a very large epic; setting process.exitCode instead of calling process.exit() avoids it. |
| 23 | low | The watch.adversary clock fix rides in a feature PR it is not part of |  | The one-line fix also repairs main, where the same test fails once real time passes 2026-10-04 12:00Z plus the threshold. It is outside ST-490's FRs (Principle I: the smallest change for the stated problem); a separate fix(harness) commit or PR would keep the history honest. Not blocking. |
| 24 | low | Report finding 'npm run test:harness passes at the PR head' is load, not the change |  | Inside the run: two artifact-lint.spec.mjs tests ('does not run the lane under --check', 'accepts --no-jev ...') timed out at 5000 ms (5.8 s, 5.6 s). Run alone at the PR head: 39 files, 827 tests passed; notion-ready specs 78/78. That high finding should not count against the PR; the symlink finding above blocks on its own. |

### Reproduction
1. echo '<11 items>' \| node .claude/scripts/notion-ready.mjs decide
2. printf '{nope' \| node .claude/scripts/notion-ready.mjs decide
3. printf '{"id":"ST-1"}' \| node .claude/scripts/notion-ready.mjs decide
4. printf '[{"status":"To do"}]' \| node .claude/scripts/notion-ready.mjs decide
5. printf '' \| node .claude/scripts/notion-ready.mjs decide
6. echo [] \| notion-ready.mjs decide
7. node .claude/scripts/notion-ready.mjs check specs/490-notion-ready/notion-sync.md
8. write "- 2026-10-04 · finish · ST-1 story\n- 2026-10-04 · comment · ST-1 · nothing to record\n" to a file → node .claude/scripts/notion-ready.mjs check <file>
9. write "- 2026-10-04 · ready · Foundations · no change\n- 2026-10-04 · finish · ST-1\n" to a file → node .claude/scripts/notion-ready.mjs check <file>
10. write "- 2026-10-04 · finish · ST-1\n[NOTION-SYNC PENDING: comment ST-1 — 429]\n" to a file → node .claude/scripts/notion-ready.mjs check <file>
11. write "- 2026-10-04 · finish · ST-1\n- 2026-10-04 · ready · F · no change\n- 2026-10-05 · finish · ST-1 again\n" to a file → node .claude/scripts/notion-ready.mjs check <file>
12. write "- 2026-10-04 · start · ST-1\n- 2026-10-04 · ready · F\n" to a file → node .claude/scripts/notion-ready.mjs check <file>
13. write "" to a file → node .claude/scripts/notion-ready.mjs check <file>
14. npm run test:harness
15. ln -s <repo> /tmp/repo   (or check out the repo under /tmp or /var/folders, which macOS symlinks to /private/...) → write a log with a finish line and no ready line after it: '- 2026-10-04 · finish · ST-1 story · QA → Done' → node /tmp/repo/.claude/scripts/notion-ready.mjs check log.md  -> exit 0, no output → node <real path>/.claude/scripts/notion-ready.mjs check log.md -> exit 1, 'no ready line after the last finish'
16. No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.
17. two ST-1 items
18. notion-ready.mjs check nope.md
19. notion-ready.mjs check
20. gh pr view 42 → gh pr diff 42 -- .claude/scripts/watch.adversary.spec.mjs
21. notion-ready.mjs
22. pipe 5000 To do items into `node .claude/scripts/notion-ready.mjs decide` through a child-process pipe → JSON.parse(stdout)
23. gh pr diff 42
24. npm run test:harness while api and web are booted

Screenshots: 32, one per route × viewport × scheme × language.
