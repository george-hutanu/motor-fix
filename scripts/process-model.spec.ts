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
// @traces 1188-FR-009
describe('no request-scoped provider', () => {
  it('declares no request or transient scope in app or library source', () => {
    const grep = spawnSync(
      'git',
      [
        'grep',
        '-nE',
        'Scope\\.(REQUEST|TRANSIENT)',
        '--',
        'apps/*/src',
        'libs/*/src',
        ':!*.spec.ts',
        ':!libs/domain/src/generated',
      ],
      { cwd: root, encoding: 'utf8' },
    );

    expect(grep.status).toBe(1);
    expect(grep.stdout).toBe('');
  });
});
