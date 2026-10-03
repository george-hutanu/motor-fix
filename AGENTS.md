# AGENTS.md

Guidance for AI agents (and humans) working in motor-fix. The spec-kit
workflow and its gates are in [CLAUDE.local.md](./CLAUDE.local.md).

## Identity — personal repo, not QLOG

Every commit and push here is **george-hutanu <hutanugeorge40@gmail.com>** on
GitHub account **george-hutanu**. Never the QLOG identity (`georgeh@qlog.co`,
`george-hutanu-qlog`), which is this machine's global default and must stay
that way for `~/code`.

- `sh .husky/identity.sh apply` writes the repo-local git config: author, and
  credentials pinned to george-hutanu's gh token. `npm install` runs it via
  `prepare`, so a fresh clone is covered.
- `.husky/pre-commit` refuses any commit not authored as george-hutanu.
- `gh` follows gh's active account, which stays QLOG. Agent sessions get
  `GH_TOKEN` for george-hutanu from the SessionStart hook; in your own
  terminal, prefix: `GH_TOKEN=$(gh auth token -u george-hutanu) gh …`.
- Never `gh auth switch` to george-hutanu, and never edit `~/.gitconfig` for
  this repo — both would change every QLOG repo under `~/code` too.

## Product and stack

MotorFix: drivers in Romania find a garage or mechanic for their car. The
product, architecture and backlog live in the Notion space **MotorFix —
Product documentation** — Architecture > Technology stack and Architecture
decisions are the source for anything the constitution does not fix.

- Given: Angular (standalone, signals) + PrimeNG with the Cockpit theme;
  NestJS, PostgreSQL, Redis; TypeScript everywhere.
- Repo: one Nx monorepo — apps `web`, `api`, `worker`, `mcp`, shared libs.
  Not scaffolded yet.
- Lint and format: Biome only, root `biome.json` (no eslint, no prettier).
  Tests: Jest from the root config, Playwright for end-to-end.
- When the scaffold lands, replace the placeholder `typecheck` script and point
  `test` at the product suite; the harness specs keep `npm run test:harness`.
