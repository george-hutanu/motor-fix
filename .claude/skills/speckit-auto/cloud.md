# speckit-auto: cloud sessions

Read at the start of a run in a Claude Code cloud session (`CLAUDE_CODE_REMOTE=true`).

## Cloud sessions

A story can run in a Claude Code cloud session (claude.ai/code), where
`CLAUDE_CODE_REMOTE=true`. Every cloud difference in the scripts is gated on
that variable, so the laptop behaves as before.

- **Environment.** Setup script: `bash scripts/cloud-setup.sh` (Node 26,
  `npm ci`, the Docker daemon, `docker compose pull postgres redis` unless
  both images are there; it is idempotent and unverified until the first
  real cloud run). Variables, by
  name only: `JEV`, `GH_PROJECT_TOKEN` (the tracker's, since the proxy's `GH_TOKEN` cannot reach Project #11), and from `.env.example` the ones the
  tests read (`DATABASE_URL`, `REDIS_URL`, `AUTH_TOKEN_SECRET`; CI's job env
  in `.github/workflows/ci.yml` lists the end-to-end set). Network level
  Trusted, or a custom list that allows `api.typesafe.ai`.
- **Node and Playwright.** The image puts Node 22 first on PATH;
  `cloud-setup.sh` puts an installed Node 26 first instead (one marked line
  at the top of `~/.bashrc`, and in `CLAUDE_ENV_FILE` when set) and installs
  the chromium revision the installed `playwright-core` pins.
- **GitHub.** `GH_TOKEN` and `GITHUB_TOKEN` hold the proxy's placeholder
  `proxy-injected`; nothing overwrites them, and no gh login is needed.
  The proxy refuses `workflow_dispatch`, commit statuses and GraphQL (so
  every `gh pr …` fails); REST pushes, reviews, comments, labels, ready and
  merge go through. REST is the default for PR and check reads everywhere,
  the laptop included: `lifecycle.mjs`, `ci-wait.mjs`, `dispatch.mjs`, the
  merge gate and the `stop:pr-lifecycle` gate read over REST
  (`.claude/scripts/lib/gh-rest.mjs`), and in the cloud their writes too; by hand, run
  `node .claude/scripts/gh.mjs` in place of `gh` for `pr
  list|view|create|edit|ready|comment|checks` (`--watch` too) and `label
  create`.
- **QA and merge.** QA starts by itself: the PR QA workflow also runs on
  `pull_request` (ready, a push, reopened) for a non-draft PR of this
  repository, one run per PR (a newer one cancels the older), and sets
  `agent-review` on the head it tested with its own token: pending, then
  success only when the run passed with no blocking findings, else failure.
  `dispatch.mjs <n> --no-wait` dispatches nothing there and finds that run
  for the head over REST; `post.mjs` posts the review and writes no status.
  A blocking finding of the tester's own is fixed and pushed, which runs QA
  again. The merge goes over REST, `lifecycle.mjs merge --pr <n>`, which
  runs `gh api -X PUT repos/{owner}/{repo}/pulls/<n>/merge -f merge_method=merge`;
  the merge gate reads the PR over REST and judges that call as it judges
  `gh pr merge`.
- **Single-repo sessions only:** a multi-repo session loads no hooks, so no
  gate would run.
- **One story per cloud session.** Never arm `watch.mjs` there; the
  orchestrating session and `/speckit-watch` stay on the laptop.
- **A resumed session is a fresh VM** with none of the gitignored files.
  In a cloud session only, the hand-off note is also posted on the PR as a
  `<!-- speckit-handoff -->` comment, and the tail runs `lifecycle.mjs handoff --restore --pr <n>`
  before reading it.
- **Tools.** The Workflow and Artifact tools are unverified in the cloud:
  `/speckit-review` falls back to Agent-tool reviewers, and
  `/speckit-design-check` logs a mock it cannot open.

