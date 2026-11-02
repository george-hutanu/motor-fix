import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import angular from '@analogjs/vite-plugin-angular';
import type { Plugin } from 'vite';
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
 * The builder bundles a project's specs without splitting, so a lazy
 * `import('./x')` in the code under test resolves at once when it runs.
 * Vitest on its own fetches that module from its server, a round trip later
 * than a spec's settle waits. Each relative `import()` outside a spec starts
 * here when its module loads, on the first line so no line number moves, and
 * the call takes that promise: the module is still evaluated after the one
 * that imports it, so a cycle between the two holds as it does in the bundle.
 */
export function eagerImports(): Plugin {
  return {
    enforce: 'post',
    name: 'motor-fix:eager-imports',
    transform(code, id) {
      if (!/\.ts$/.test(id) || /\.spec\.ts$/.test(id)) return undefined;
      const hoisted: string[] = [];
      const out = code.replace(
        /\bimport\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/g,
        (_call, quote: string, path: string) => {
          const name = `__eager${hoisted.length}`;
          hoisted.push(
            `const ${name} = import(${quote}${path}${quote}); ${name}.catch(() => undefined);`,
          );
          return name;
        },
      );
      return hoisted.length
        ? { code: `${hoisted.join(' ')} ${out}`, map: null }
        : undefined;
    },
  };
}

/** Web's specs that run in node (its test-node target), under apps/web/src. */
export const WEB_NODE_SPECS = [
  'server/**/*.spec.ts',
  'app/app.config.spec.ts',
  'app/app.config.server.adversary.spec.ts',
];

/**
 * The Vitest config of an Angular project. The project's `test` target (the
 * Angular unit-test builder, which compiles the specs and initialises TestBed
 * itself) reads only the test options from it; Stryker and the edit hooks run
 * Vitest on it directly, so it also compiles Angular, resolves the aliases and
 * runs the setup file. MUTATION_SPECS narrows the specs to one shard's.
 * `only` and `skip` are spec globs under `<root>/src`, so web's server specs
 * run in node on their own config and stay out of its jsdom one.
 */
export function angularTest(
  root: string,
  environment = 'jsdom',
  { only, skip = [] }: { only?: string[]; skip?: string[] } = {},
) {
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
      eagerImports(),
    ],
    resolve: { alias: aliases() },
    root: workspace,
    test: {
      ...test,
      exclude: [
        '**/node_modules/**',
        ...skip.map((glob) => `${root}/src/${glob}`),
        ...(shard?.exclude ?? []),
      ],
      include:
        shard?.include ??
        (only ?? ['**/*.spec.ts']).map((glob) => `${root}/src/${glob}`),
      setupFiles: [join(workspace, root, 'src/test-setup.ts')],
    },
  });
}
