import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import angular from '@analogjs/vite-plugin-angular';
import { defineConfig } from 'vitest/config';

const workspace = import.meta.dirname;

// The workspace aliases, so a spec run without the Angular builder resolves
// `@motor-fix/*` as the builder does.
function aliases() {
  const { paths } = JSON.parse(
    readFileSync(join(workspace, 'tsconfig.base.json'), 'utf8'),
  ).compilerOptions as { paths: Record<string, string[]> };
  return Object.entries(paths)
    .sort(([a], [b]) => b.length - a.length)
    .map(([key, [target]]) => ({
      find: new RegExp(
        `^${key.replace(/[.+?^${}()|[\]\\/]/g, '\\$&').replace('*', '(.*)')}$`,
      ),
      replacement: join(workspace, target ?? '').replace('*', '$1'),
    }));
}

/**
 * The Vitest config of an Angular project. The project's `test` target (the
 * Angular unit-test builder, which compiles the specs and initialises TestBed
 * itself) reads only the test options from it; Stryker and the edit hooks run
 * Vitest on it directly, so it also compiles Angular, resolves the aliases and
 * runs the setup file. MUTATION_SPECS narrows the specs to one shard's.
 */
export function angularTest(root: string, environment = 'jsdom') {
  const test = { clearMocks: true, environment, globals: true, isolate: true };
  const target = process.env['NX_TASK_TARGET_TARGET'];
  if (target === 'test' || target === 'test-node')
    return defineConfig({ test });
  const specs = process.env['MUTATION_SPECS'];
  const shard: { include: string[]; exclude: string[] } | undefined = specs
    ? JSON.parse(specs)
    : undefined;
  return defineConfig({
    plugins: [
      angular({ tsconfig: join(workspace, root, 'tsconfig.spec.json') }),
    ],
    resolve: { alias: aliases() },
    root: workspace,
    test: {
      ...test,
      exclude: ['**/node_modules/**', ...(shard?.exclude ?? [])],
      include: shard?.include ?? [`${root}/src/**/*.spec.ts`],
      setupFiles: [join(workspace, root, 'src/test-setup.ts')],
    },
  });
}
