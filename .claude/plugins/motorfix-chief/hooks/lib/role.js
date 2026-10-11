// Who this session is (research R10): Chief runs in the main checkout, whose
// git dir is the common dir; a worktree's git dir sits under it.
// Set once by register.js at session.start, read by every part.
export const role = { chief: false, cwd: null, main: null, remote: null };

export function fromRevParse(stdout) {
  const [gitDir, commonDir] = stdout.trim().split('\n');
  if (!gitDir || !commonDir) return { chief: false, main: null };
  return {
    chief: gitDir === commonDir,
    main: commonDir.replace(/\/\.git\/?$/, ''),
  };
}

export async function detect($, cwd) {
  role.cwd = cwd;
  role.remote = (await $.env.get('CLAUDE_CODE_REMOTE')) ?? null;
  const r = await $.process.run(
    [
      'git',
      'rev-parse',
      '--path-format=absolute',
      '--git-dir',
      '--git-common-dir',
    ],
    {
      cwd,
      timeoutMs: 10_000,
    },
  );
  Object.assign(
    role,
    r.exitCode === 0 ? fromRevParse(r.stdout) : { chief: false, main: null },
  );
  return role;
}
