// Where the tracker writes. motor-fix is public, and issue titles can name an
// open weakness, so every issue, label and milestone lives in the private
// specs repository; the code repository only receives a Closes line on a PR.
import { existsSync } from "node:fs";
import { join } from "node:path";

export const OWNER = "george-hutanu";
export const ISSUE_REPO = "motor-fix-specs";
export const CODE_REPO = "motor-fix";

/** The REST path of a code-repository pull request (absolute, so it never resolves to ISSUE_REPO). */
export const pullPath = (number) => `/repos/${OWNER}/${CODE_REPO}/pulls/${number}`;

/** The closing keyword a motor-fix PR body carries for an issue in ISSUE_REPO. */
export const closesLine = (number) => `Closes ${OWNER}/${ISSUE_REPO}#${number}`;

/**
 * The checkout's clone of ISSUE_REPO: `.motor-fix-specs/` (with `specs` a
 * symlink into it) once specs-repo.mjs has moved it there and exports its
 * place; until then it is `specs/` itself.
 */
export function specsClone(root, specsRepo = {}) {
  const exported = specsRepo.cloneDir?.(root) ?? (specsRepo.CLONE_DIR ? join(root, specsRepo.CLONE_DIR) : null);
  if (exported) return exported;
  const moved = join(root, ".motor-fix-specs");
  return existsSync(join(moved, ".git")) ? moved : join(root, "specs");
}
