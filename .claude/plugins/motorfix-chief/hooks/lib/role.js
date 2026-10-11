// Who this session is: Chief runs in the main checkout, whose
// git dir is the common dir; a worktree's git dir sits under it. Each part
// runs `git rev-parse` itself at session.start (`$` never crosses an import)
// and reads its output here.
export const REV_PARSE = [
  'git',
  'rev-parse',
  '--path-format=absolute',
  '--git-dir',
  '--git-common-dir',
];

export function fromRevParse(stdout) {
  const [gitDir, commonDir] = stdout.trim().split('\n');
  if (!gitDir || !commonDir) return { chief: false, main: null };
  return {
    chief: gitDir === commonDir,
    main: commonDir.replace(/\/\.git\/?$/, ''),
  };
}
