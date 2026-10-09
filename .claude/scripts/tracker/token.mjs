// The token for the tracker scripts. It needs the project scope, which the
// session's own GH_TOKEN lacks, so it comes from GH_PROJECT_TOKEN or from a gh
// login kept in its own config directory.
import { homedir } from "node:os";

import { spawnRun } from "../lib/gh-rest.mjs";
import { GitHubError } from "./github.mjs";

export class TokenError extends Error {}

const REFRESH = "gh auth refresh -h github.com -u george-hutanu -s project,read:project";

export function projectToken({ env = process.env, run = (file, args, opts) => spawnRun({ env: opts.env })(file, args) } = {}) {
  if (env.GH_PROJECT_TOKEN?.trim()) return env.GH_PROJECT_TOKEN.trim();
  const dir = `${env.HOME?.trim() || homedir()}/.config/gh-motorfix`;
  const { GH_TOKEN, GITHUB_TOKEN, ...rest } = env;
  const r = run("gh", ["auth", "token"], { env: { ...rest, GH_CONFIG_DIR: dir } });
  const token = r.code === 0 ? r.stdout.trim() : "";
  if (!token) {
    throw new TokenError(
      ["No GitHub token with the project scope.", `  Looked in: GH_PROJECT_TOKEN, then \`gh auth token\` with GH_CONFIG_DIR=${dir}`, `  Grant it:  ${REFRESH}`].join("\n"),
    );
  }
  return token;
}

/** The token's login, once a read of the user's Projects shows it has the scope. */
export async function assertProjectScope(github) {
  try {
    const data = await github.graphql("query Probe { viewer { login projectsV2(first: 1) { totalCount } } }");
    return data.viewer.login;
  } catch (error) {
    if (error instanceof GitHubError && error.type === "INSUFFICIENT_SCOPES") {
      throw new TokenError(`The GitHub token lacks the project scope (GitHub: INSUFFICIENT_SCOPES).\n  Grant it:  ${REFRESH}`);
    }
    throw error;
  }
}
