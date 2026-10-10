// The token for the tracker scripts: GH_PROJECT_TOKEN when set, else the
// session's GH_TOKEN (george-hutanu's, which holds the project scope), else
// george-hutanu's own gh login. A scope it lacks is named with its fix.
import { spawnRun } from "../lib/gh-rest.mjs";
import { GitHubError } from "./github.mjs";

export class TokenError extends Error {}

export const REFRESH = "gh auth refresh -h github.com -u george-hutanu -s project,read:project";

export function projectToken({ env = process.env, run = (file, args, opts) => spawnRun({ env: opts.env })(file, args) } = {}) {
  if (env.GH_PROJECT_TOKEN?.trim()) return env.GH_PROJECT_TOKEN.trim();
  if (env.GH_TOKEN?.trim()) return env.GH_TOKEN.trim();
  // gh's own login for george-hutanu: no token variable or config directory may stand in for it.
  const { GH_TOKEN, GITHUB_TOKEN, GH_CONFIG_DIR, ...rest } = env;
  const r = run("gh", ["auth", "token", "-u", "george-hutanu"], { env: rest });
  const token = r.code === 0 ? r.stdout.trim() : "";
  if (!token) {
    throw new TokenError(
      ["No GitHub token with the project scope.", "  Looked in: GH_PROJECT_TOKEN, GH_TOKEN, then `gh auth token -u george-hutanu`", `  Grant it:  ${REFRESH}`].join("\n"),
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
