Mode: harden — every task in tasks.md is checked off.

- `/speckit-harden` is the gate between implement and review: mechanical audits,
  adversarial tests, durability read, fixes re-verified.
- Mutation is no part of harden or any task: it runs only in the Mutation
  workflow (`.github/workflows/mutation.yml`) on `main`'s schedule and by
  hand, never on this machine, and nothing here dispatches or waits for it. The `break`
  floor in that project's `stryker.config.json` is a ratchet — raise it after a harden pass, never lower
  it. A surviving mutant is a missing assertion unless it is genuinely
  equivalent, and that earns a `Stryker disable` comment saying why.
- Then `/speckit-review` (or the `spec-reviewer` and `code-reviewer` subagents on
  the feature diff). CRITICAL/HIGH findings block completion.
