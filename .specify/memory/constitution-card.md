# Constitution card — v3.0.0

For authors: each principle of `.specify/memory/constitution.md` in one line,
with the gate that enforces it. The full text governs, and the reviewers and
the PR tester read it. `.claude/scripts/constitution-card.spec.mjs` fails when
the principles or the version drift.

- **I. No Bloated Code (NON-NEGOTIABLE)** — the smallest change that fully solves it; no speculative layer, knob, dead code, or dependency where ~20 lines do. Gate: review (`code-reviewer`, `spec-reviewer`).
- **II. Test Discipline** — failing tests first; colocated Jest specs; API tests on real PostgreSQL and Redis; Playwright end to end; no FR or task id in source except a whole-line `// @traces` comment naming `<feature>-FR-<n>` ids in a test file. Gates: `red-first-gate.mjs`, `post-edit-check.sh`, `stop-test-gate.sh`, `.husky/pre-commit`.
- **III. The Given Stack** — Angular with Spartan UI and the Cockpit theme, NestJS, PostgreSQL, Redis, TypeScript; free and open-source front-end dependencies; no substitute without an amendment. Gate: review.
- **IV. One Repository, One Toolchain** — one Nx monorepo, one API, one worker; no GraphQL, global store, search engine or second broker; Biome only, root Jest; a submodule gets its own subfolder, a web component is a `<name>/` folder with `<name>.ts`, `<name>.html`, `<name>.css`. Gates: `post-edit-check.sh`, `stop-test-gate.sh`, `structure-check.ts`, review.
- **V. Rules Live in One Place** — REST with OpenAPI and a generated client; DTOs from the contracts library, validated at the edge; one use case per rule; trust checked on the server. Gate: review.
- **VI. PostgreSQL Is the Truth** — Redis never holds the only copy; a change is saved with its event in the same transaction. Gate: review.
- **VII. The Task Lifecycle Is Autonomous (NON-NEGOTIABLE)** — Planning and a draft PR linked on its GitHub issue in Project MotorFix; push every commit; ready is QA; CI and the PR tester side by side; merge only on `agent-review` success with every check green, then Done; Blocked with a reason when stuck; one stage label and the type label; the main checkout holds no edits to tracked files and is fast-forwarded after each merge. Gates: `pr-lifecycle-gate.mjs`, `merge-gate.mjs`, `main-checkout-gate.mjs`.

Always: a one-line Conventional Commit (`commit-msg-policy.js`); spec-drift on
`feat`/`fix`/`perf` (`spec-drift.mjs --staged`); author george-hutanu
(`.husky/identity.sh`); no force-push, `reset --hard` or `clean -f`
(`bash-guard.mjs`); a new service, queue, outside call or endpoint listed with
its dashboard and alerts (`scripts/observability-inventory.ts`). The Agent Execution Rules (scope is the deliverable,
grounded claims, finish the task, report faithfully) are in the full file.
