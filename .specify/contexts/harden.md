Mode: harden — every task in tasks.md is checked off.

- `/speckit-harden` is the gate between implement and review: mechanical audits,
  adversarial tests, mutation score, durability read, fixes re-verified.
- Mutation is owned by the workspace it covers: `npm run test:mutation -w
  apps/server`, `-w apps/scanner`. The `break` floor in that workspace's
  `stryker.config.json` is a ratchet — raise it after a harden pass, never lower
  it. A surviving mutant is a missing assertion unless it is genuinely
  equivalent, and that earns a `Stryker disable` comment saying why.
- Then `/speckit-review` (or the `spec-reviewer` and `code-reviewer` subagents on
  the feature diff). CRITICAL/HIGH findings block completion.
- Finish with `/speckit-agent-context-update` so AGENTS.md matches what shipped.
