// Where the tracker writes. motor-fix is public, and issue titles can name an
// open weakness, so every issue, label and milestone lives in the private
// specs repository; the code repository only receives a Closes line on a PR.
export const OWNER = "george-hutanu";
export const ISSUE_REPO = "motor-fix-specs";
export const CODE_REPO = "motor-fix";

/** The REST path of a code-repository pull request (absolute, so it never resolves to ISSUE_REPO). */
export const pullPath = (number) => `/repos/${OWNER}/${CODE_REPO}/pulls/${number}`;

/** The closing keyword a motor-fix PR body carries for an issue in ISSUE_REPO. */
export const closesLine = (number) => `Closes ${OWNER}/${ISSUE_REPO}#${number}`;
