// Claude Code PreToolUse hook (matcher: Bash) — block commands that destroy
// state or violate this repo's rules. Ported from speckit-demo; two of its
// five rules were dropped rather than carried over, because they encode the
// OTHER repo's constitution:
//   * `npm install` without -D — speckit-demo forbids runtime dependencies.
//     Blastradius ships real runtime deps in every workspace; blocking that
//     would fight normal work.
//   * `rm ~/.taskr` — that is taskr's data store; it does not exist here.
//
// Kept (exit 2, reason fed back to the model):
//   - history-destroying git: push --force / -f (--force-with-lease allowed),
//     reset --hard, clean -f
// Added for this repo:
//   - deletion of .work/ — scan outputs and cloned repos live there and are
//     expensive to reproduce (see npm run scan:dev).
//
// Deliberately NOT blocked: plain `git push`. The rule that matters here —
// "never push until the user explicitly says to push"
// (.claude/skills/speckit-git-feature/SKILL.md) — is a rule about acting
// unasked, and a hard block would also break the case where the user DOES ask.
// That one stays prose.
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let cmd = "";
  try {
    cmd = JSON.parse(raw).tool_input?.command ?? "";
  } catch {
    process.exit(0);
  }
  const block = (why) => {
    console.error(`Bash guard: ${why}`);
    process.exit(2);
  };

  if (/git\s+push\b(?!.*--force-with-lease).*(\s--force\b|\s-f\b)/.test(cmd))
    block("force-push blocked — use --force-with-lease, or ask the user to push.");
  if (/git\s+reset\s+--hard/.test(cmd))
    block("`git reset --hard` destroys uncommitted work — use `git stash` or ask the user.");
  if (/git\s+clean\s+-\w*f/.test(cmd))
    block("`git clean -f` deletes untracked files irreversibly — and specs/, .specify/ and .claude/ are all untracked here. List them first and ask.");
  if (/\brm\b[^|;&]*\.work\b/.test(cmd))
    block(".work/ holds scan outputs and cloned repos — deleting it throws away expensive state. Ask first.");

  process.exit(0);
});
