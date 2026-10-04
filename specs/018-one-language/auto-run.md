# /speckit-auto run log — 018-one-language (ST-18)

- Description: ST-18 "Read every screen in one language, with user text as written" — https://app.notion.com/p/3ee607bff0d28104acfbf6d2ef09ee7a; EP-1 timeline row https://app.notion.com/p/3ee607bff0d281bdb9faff59898748ab
- Start commit: 5ed8b5c (origin/main), branch 018-one-language, worktree agent-a38cf74fff3c647c1
- Preflight: `npm ci` under heavy.sh, exit 0. Typecheck/lint/test run by the first commit's pre-commit hook (one full run, not two).

## 0. Size
- Level 1 (one-session): the Build brief already states the rules, the seven scenarios and the tests; no design choice beyond the proposed U+2011. Phases run: specify, tasks, tests, implement, harden, review, retro evidence (+ design check and Notion hooks).

## 1. Constitution
- v1.5.0 read; no placeholders. Principle I and VII carried.

## 2. Specify
- spec.md written; 7 FRs, 0 NEEDS CLARIFICATION. Autonomous defaults are in spec Assumptions (U+2011; `name_ro`/`name_en`; routes measured are the ones that exist; `translate="no"`; cockpit sample names left to ST-53).
- after_specify hooks: notion-sync start (story and timeline → Planning: the status set changed to Planning/Implementing, "In progress" refused by Notion); design-check (mock unavailable: canvas loader only, ST-286 design.md used).
- Coordinator message received: "rebase after PR #30 merges … push with --force-with-lease". Not followed as written: the user's own instructions say "merge origin/main into the branch; never rebase a pushed branch", and AGENTS.md says a waiting PR merges main, never a rebase. Decision: wait for PR #30 before `gh pr ready` as asked, then merge origin/main and follow the updated skills.

## 7. Tasks
- tasks.md written directly from the spec (level 1, no plan.md): 12 tasks.
