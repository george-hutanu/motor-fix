import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The PR QA workflow checks the tester out sparsely (`path: tester`) and runs
// its scripts with node. A relative import that reaches outside the sparse
// paths fails at module load, before the app boots: ST-1356, where
// dispatch.mjs's `../../../scripts/docs-only.ts` failed every run.

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const WORKFLOW = join(ROOT, '.github/workflows/pr-qa.yml');

/** The tester checkout's sparse paths, read from the checkout step whose path is `tester`. */
export function testerSparsePaths(text) {
  const steps = text.split(/\n(?=\s*- (?:uses|name|run):)/);
  const step = steps.find((s) => /^\s*path:\s*tester\s*$/m.test(s));
  assert.ok(step, 'pr-qa.yml has no checkout with path: tester');
  const lines = step.split('\n');
  const at = lines.findIndex((l) => /^\s*sparse-checkout:/.test(l));
  assert.notEqual(at, -1, 'the tester checkout has no sparse-checkout');
  const inline = lines[at].replace(/^\s*sparse-checkout:\s*/, '').trim();
  if (inline && inline !== '|') return [inline];
  const indent = lines[at].match(/^\s*/)[0].length;
  const out = [];
  for (const l of lines.slice(at + 1)) {
    if (!l.trim()) continue;
    if (l.match(/^\s*/)[0].length <= indent) break;
    out.push(l.trim());
  }
  return out;
}

/** The scripts the workflow runs out of the tester checkout, relative to the repository. */
export function testerEntries(text) {
  return [...new Set([...text.matchAll(/\bnode\s+tester\/(\S+?\.(?:mjs|js|ts|mts))\b/g)].map((m) => m[1]))];
}

const SPECIFIERS = [/\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g];

/** Every file reached from `entries` by relative imports, transitively: { files, missing }. */
export function relativeImports(root, entries) {
  const files = new Set();
  const missing = [];
  const queue = entries.map((e) => resolve(root, e));
  while (queue.length) {
    const file = queue.shift();
    if (files.has(file)) continue;
    files.add(file);
    // Whole-line comments (// …, and JSDoc's * lines) often quote an import as usage.
    const code = readFileSync(file, 'utf8').replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, '');
    for (const re of SPECIFIERS) {
      for (const [, spec] of code.matchAll(re)) {
        if (!spec.startsWith('.')) continue;
        const target = resolve(dirname(file), spec);
        if (existsSync(target)) queue.push(target);
        else missing.push(`${relative(root, file)} -> ${spec}`);
      }
    }
  }
  return { files: [...files].map((f) => relative(root, f).split(sep).join('/')), missing };
}

/** Whether a repository path is in a cone-mode sparse checkout of `paths` (root files always are). */
export const inSparse = (file, paths) => !file.includes('/') || paths.some((p) => file === p || file.startsWith(`${p.replace(/\/+$/, '')}/`));

/** The files reached from the entries that the sparse checkout would not hold. */
export function outsideSparse(root, entries, paths) {
  return relativeImports(root, entries).files.filter((f) => !inSparse(f, paths));
}

describe('PR QA workflow: the tester checkout holds what its scripts import', () => {
  const text = readFileSync(WORKFLOW, 'utf8');
  const paths = testerSparsePaths(text);
  const entries = testerEntries(text);

  // @traces 1362-FR-001
  it('runs at least the QA run and the baseline from the tester checkout', () => {
    assert.ok(entries.includes('.claude/scripts/pr-test/run.mjs'), entries.join(', '));
    assert.ok(entries.includes('.claude/scripts/pr-test/baseline.mjs'), entries.join(', '));
  });

  // @traces 1362-FR-001
  it('every relative import those scripts reach, transitively, exists and lies in the sparse checkout', () => {
    const { files, missing } = relativeImports(ROOT, entries);
    assert.deepEqual(missing, []);
    assert.ok(files.includes('scripts/docs-only.ts'), 'the walk reaches dispatch.mjs and its docs-only.ts import');
    assert.deepEqual(outsideSparse(ROOT, entries, paths), [], `sparse-checkout: ${paths.join(', ')}`);
  });
});

describe('the sparse-checkout check itself', () => {
  // @traces 1362-FR-002
  it('names a script that imports a path outside the sparse checkout', () => {
    const root = mkdtempSync(join(tmpdir(), 'pr-qa-sparse-'));
    try {
      mkdirSync(join(root, '.claude/scripts/pr-test'), { recursive: true });
      mkdirSync(join(root, 'scripts'), { recursive: true });
      writeFileSync(join(root, '.claude/scripts/pr-test/run.mjs'), "import { a } from './helper.mjs';\nexport const b = a;\n");
      writeFileSync(join(root, '.claude/scripts/pr-test/helper.mjs'), "export { isDocsOnly as a } from '../../../scripts/docs-only.ts';\nconst late = () => import('../lib/late.mjs');\n");
      mkdirSync(join(root, '.claude/scripts/lib'), { recursive: true });
      writeFileSync(join(root, '.claude/scripts/lib/late.mjs'), 'export {};\n');
      writeFileSync(join(root, 'scripts/docs-only.ts'), 'export const isDocsOnly = () => true;\n');
      const entries = ['.claude/scripts/pr-test/run.mjs'];
      assert.deepEqual(outsideSparse(root, entries, ['.claude/scripts']), ['scripts/docs-only.ts']);
      assert.deepEqual(outsideSparse(root, entries, ['.claude/scripts', 'scripts']), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // @traces 1362-FR-002
  it('reads a one-line and a block sparse-checkout, and the node entries', () => {
    const one = '      - uses: actions/checkout@v7\n        with:\n          path: tester\n          sparse-checkout: .claude/scripts\n          persist-credentials: false\n';
    assert.deepEqual(testerSparsePaths(one), ['.claude/scripts']);
    const block = '      - uses: actions/checkout@v7\n        with:\n          path: tester\n          sparse-checkout: |\n            .claude/scripts\n            scripts\n          persist-credentials: false\n      - uses: actions/checkout@v7\n        with:\n          path: pr\n';
    assert.deepEqual(testerSparsePaths(block), ['.claude/scripts', 'scripts']);
    assert.deepEqual(testerEntries('run: node tester/.claude/scripts/pr-test/run.mjs "$PR" && node tester/x.ts'), ['.claude/scripts/pr-test/run.mjs', 'x.ts']);
  });

  it('counts root files in, as cone mode does, and nothing by a shared prefix', () => {
    assert.equal(inSparse('package.json', ['.claude/scripts']), true);
    assert.equal(inSparse('scripts-extra/x.ts', ['scripts']), false);
    assert.equal(inSparse('scripts/x.ts', ['scripts/']), true);
  });
});
