import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');

const ENTRIES = [
  'apps/api/src/main.ts',
  'apps/worker/src/main.ts',
  'apps/mcp/src/main.ts',
  'apps/web/src/server.ts',
];

// @traces 1188-FR-005
describe('one Node process per replica', () => {
  it.each(ENTRIES)(
    '%s starts no cluster, child process or worker pool',
    (entry) => {
      const source = readFileSync(join(root, entry), 'utf8');

      expect(source).not.toMatch(
        /node:(cluster|child_process|worker_threads)|['"](cluster|child_process|worker_threads)['"]|\bfork\(/,
      );
    },
  );
});

// User context travels in the async-local storage of logging.ts; a provider
// built per request would rebuild its whole graph on every call.
const SOURCE_PATHSPEC = [
  ':(glob)apps/*/src/**',
  ':(glob)libs/*/src/**',
  ':(exclude,glob)**/*.spec.ts',
  ':(exclude)libs/domain/src/generated',
];

const gitGrep = (args: string[]) =>
  spawnSync('git', ['grep', ...args, '--', ...SOURCE_PATHSPEC], {
    cwd: root,
    encoding: 'utf8',
  });

// @traces 1188-FR-009
describe('no request-scoped provider', () => {
  it('searches the app and library sources that hold providers', () => {
    const grep = gitGrep(['-l', '@Injectable(']);
    const files = grep.stdout.split('\n').filter(Boolean);

    expect(files).toContain('apps/mcp/src/auth/auth.actor.ts');
    expect(files).toContain(
      'libs/domain/src/admin/admin-accounts/admin-accounts.service.ts',
    );
    expect(files.length).toBeGreaterThan(20);
  });

  it('declares no request or transient scope in app or library source', () => {
    const grep = gitGrep(['-nE', 'Scope\\.(REQUEST|TRANSIENT)']);

    expect(grep.status).toBe(1);
    expect(grep.stdout).toBe('');
  });
});
