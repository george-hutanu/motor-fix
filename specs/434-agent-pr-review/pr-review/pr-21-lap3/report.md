**Agent review: success** — PR #21 at `3893394`, lap 3

Blocking: 0 (blocker 0, high 0) · medium 4 · low 2. Booted: postgres, redis, api, web.
- No Docker on this machine: private PostgreSQL and Redis on free ports, no object store.
- No changed GET endpoint without path parameters.

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | medium | api readiness: storage down |  |  |
| 2 | medium (pre-existing) | Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element) | / · desktop · light · ro (+11 more) | shots/home-desktop-light-ro.png |
| 3 | medium (pre-existing) | Accessibility (moderate): region — All page content should be contained by landmarks (2 elements) | / · desktop · light · ro (+11 more) | shots/home-desktop-light-ro.png |
| 4 | medium | The pre-merge `debt` step edits deferred.md after the tester passed on the head, and nothing says to commit it |  | .claude/skills/speckit-auto/SKILL.md (hand-off step 6); .claude/skills/speckit-pr-test/SKILL.md step 5; spec FR-018 |
| 5 | low | speckit-review still points at hand-off steps 3–6, but the merge is now step 7 |  | .claude/skills/speckit-review/SKILL.md:178 |
| 6 | low | `debt-tasks.mjs mark` accepts any line number and writes junk past the end of the file |  | .claude/scripts/debt-tasks.mjs:77-81 |

### Reproduction
1. No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.
2. Open / at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule landmark-one-main on html. → Observe: Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element).
3. Open / at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule region on p:nth-child(2). → Observe: Accessibility (moderate): region — All page content should be contained by landmarks (2 elements).
4. .claude/skills/speckit-auto/SKILL.md hand-off step 6: `Before the merge, speckit-notion-sync debt files every deferred bullet not yet filed`. It runs after step 5 (agent-review success on the head). speckit-pr-test step 5 says the same: `On success, file the lap's deferred findings the same way before merging.` → `debt-tasks.mjs mark` writes `— Notion: <url>` onto specs/<feature>/deferred.md in the working tree. Neither skill says to commit and push that change → Commit it: the head moves, agent-review on the new head is missing, the merge gate refuses, and a whole extra tester lap is needed (this PR's lap 3 exists for exactly this reason). Leave it uncommitted: the write-back that FR-018 relies on (`so no later run files it twice`) never reaches main → Fix: run `debt` before the final tester lap (with the deferred findings, while fixing), or tell the skills to commit the marked file and accept the retest
5. .claude/skills/speckit-review/SKILL.md:178 `exactly as /speckit-auto's hand-off steps 3–6 do` → This commit inserted the `debt` step as step 6 and moved the merge (with its origin/main re-merge and `finish`) to step 7, so the range no longer covers the merge. The prose `then merge` keeps it reachable; the range should read 3–7
6. .claude/scripts/debt-tasks.mjs markFiled: `lines[line] = `${lines[line]} — Notion: ${url}``, with no check that `line` is a bullet or inside the file → markFiled('- a — **low** — x\n', 7, url) returns the file plus five blank lines and `undefined — Notion: https://n/1`. `mark` exits 0. A NaN line is a silent no-op that also exits 0 → Only `plan` output feeds it today, so this is hardening: refuse (exit 64) unless `/^- /.test(lines[line])`

Screenshots: 24, one per route × viewport × scheme × language.
