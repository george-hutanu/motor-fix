// The Dependabot rule, shared by the gates (pr-lifecycle-gate.mjs,
// merge-gate.mjs) and the workflow that writes an exempt PR's agent-review
// (pr-test/dependabot-review.mjs). Dependency-free: the workflow
// runs it from a sparse checkout of .claude/scripts with no install.

const DEPENDABOT = new Set(["app/dependabot", "dependabot[bot]"]);
/** Who may commit a Dependabot commit: GitHub itself, or Dependabot. */
const DEPENDABOT_COMMITTERS = new Set(["web-flow", "dependabot[bot]"]);

/** Dependabot opened the PR: the only PRs whose committers the gates read. */
export const openedByDependabot = (pr) => DEPENDABOT.has(pr?.author?.login ?? "");

/** One commit Dependabot wrote alone, committed by GitHub or Dependabot under a verified signature. */
export const dependabotCommit = (c) =>
  Array.isArray(c?.authors) &&
  c.authors.length > 0 &&
  c.authors.every((a) => DEPENDABOT.has(a?.login ?? "")) &&
  DEPENDABOT_COMMITTERS.has(c.committer?.login ?? "") &&
  c.verified === true;

/**
 * Dependabot opened the PR and wrote every commit on it, each committed by
 * GitHub or Dependabot under a verified signature: read off the authors and
 * the REST committers, never the title or branch.
 */
export const isDependabot = (pr) =>
  openedByDependabot(pr) && Array.isArray(pr.commits) && pr.commits.length > 0 && pr.commits.every(dependabotCommit);
