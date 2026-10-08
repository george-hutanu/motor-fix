// Checks the folder rules (AGENTS.md "Folder structure") over the files git
// tracks under each app's and lib's src/:
//
//   1. A module root holds its own files (`<module>.*`, `index.ts`, and `main.*`
//      at a project's src/), and lone shared files; two or more files of one
//      stem family (`bell.controller.ts`, `bell.service.ts`) are a submodule
//      left flat, and belong in `<module>/bell/`.
//   2. A web component is `<name>/<name>.ts` with `templateUrl: './<name>.html'`
//      and, when it has styles, `styleUrl: './<name>.css'`; never inline.
//
// Violations that predate the check are listed in scripts/structure-baseline.json,
// which only shrinks: a listed file that no longer violates fails as stale, and
// with --base <ref> an entry the ref's baseline lacks fails as growth.
//
//   node scripts/structure-check.ts [--base <ref>]

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { parseArgs } from 'node:util';

export type Violation = {
  rule: 'submodules' | 'components';
  file: string;
  detail: string;
};
export type Baseline = { submodules: string[]; components: string[] };

const BASELINE = 'scripts/structure-baseline.json';
const RULES = ['submodules', 'components'] as const;
const SOURCE = /^(?:apps|libs)\/[^/]+\/src\//;
const EXCLUDED = [
  'libs/ui-cockpit/',
  'libs/data-access/',
  'libs/domain/src/generated/',
  'apps/web-e2e/',
];
const WEB = 'apps/web/src/';

const stemOf = (name: string) => name.slice(0, name.indexOf('.'));

const isCounted = (path: string) =>
  SOURCE.test(path) &&
  !EXCLUDED.some((prefix) => path.startsWith(prefix)) &&
  path.endsWith('.ts') &&
  !path.endsWith('.spec.ts');

function isOwn(dir: string, name: string): boolean {
  const module = posix.basename(dir);
  if (name === 'index.ts' || name.startsWith(`${module}.`)) return true;
  return module === 'src' && stemOf(name) === 'main';
}

export function submoduleViolations(paths: string[]): Violation[] {
  const byDir = new Map<string, string[]>();
  for (const path of paths.filter(isCounted)) {
    const dir = posix.dirname(path);
    const name = posix.basename(path);
    if (!isOwn(dir, name)) byDir.set(dir, [...(byDir.get(dir) ?? []), name]);
  }
  const found: Violation[] = [];
  for (const [dir, names] of byDir) {
    const stems = [...new Set(names.map(stemOf))].sort(
      (a, b) => a.length - b.length,
    );
    const keyOf = (name: string) => {
      const stem = stemOf(name);
      return stems.find((k) => stem === k || stem.startsWith(`${k}-`)) ?? stem;
    };
    const keys = names.map(keyOf);
    names.forEach((name, i) => {
      if (keys.filter((k) => k === keys[i]).length < 2) return;
      found.push({
        detail: `flat submodule "${keys[i]}", move it to ${dir}/${keys[i]}/`,
        file: `${dir}/${name}`,
        rule: 'submodules',
      });
    });
  }
  return found.sort((a, b) => a.file.localeCompare(b.file));
}

const quoted = (text: string) =>
  [...text.matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);

function urlProblems(
  text: string,
  dir: string,
  name: string,
  exists: (path: string) => boolean,
): string[] {
  const templates = [
    ...text.matchAll(/templateUrl\s*:\s*(['"`][^'"`]+['"`])/g),
  ].flatMap((m) => quoted(m[1]));
  const styles = [
    ...[...text.matchAll(/styleUrl\s*:\s*(['"`][^'"`]+['"`])/g)],
    ...[...text.matchAll(/styleUrls\s*:\s*\[([^\]]*)\]/g)],
  ].flatMap((m) => quoted(m[1]));
  const paths: string[] = [];
  if (templates.some((url) => url !== `./${name}.html`))
    paths.push(`templateUrl must be ./${name}.html`);
  if (styles.some((url) => url !== `./${name}.css`))
    paths.push(`styleUrl must be ./${name}.css`);
  for (const url of [...templates, ...styles]) {
    if (!exists(posix.join(dir, url))) paths.push(`${url} is not on disk`);
  }
  return paths;
}

export function componentViolations(
  file: string,
  text: string,
  exists: (path: string) => boolean,
): Violation[] {
  if (
    !file.startsWith(WEB) ||
    !isCounted(file) ||
    !text.includes('@Component(')
  )
    return [];
  const dir = posix.dirname(file);
  const name = stemOf(posix.basename(file));
  const at = (detail: string): Violation => ({
    detail,
    file,
    rule: 'components',
  });
  const found: Violation[] = [];

  if (/\b(template|styles)\s*:/.test(text))
    found.push(at('inline template or styles'));

  if (posix.basename(dir) !== name || posix.basename(file) !== `${name}.ts`) {
    const folder = posix.basename(dir) === name ? dir : `${dir}/${name}`;
    found.push(at(`expected ${folder}/${name}.ts`));
  }

  const paths = urlProblems(text, dir, name, exists);
  if (paths.length) found.push(at(paths.join('; ')));

  return found;
}

export function baselineErrors(
  found: Violation[],
  baseline: Baseline,
  base?: { ref: string; baseline: Baseline | null },
): string[] {
  const errors = found
    .filter((v) => !baseline[v.rule].includes(v.file))
    .map((v) => `${v.file}: ${v.detail}`);
  for (const rule of RULES) {
    const violating = new Set(
      found.filter((v) => v.rule === rule).map((v) => v.file),
    );
    for (const file of baseline[rule]) {
      if (!violating.has(file))
        errors.push(
          `stale baseline entry: ${rule} ${file}, remove it from ${BASELINE}`,
        );
      if (base?.baseline && !base.baseline[rule].includes(file))
        errors.push(`baseline grew: ${file} is not in ${base.ref}'s baseline`);
    }
  }
  return errors;
}

export function scanRepo(root: string): {
  violations: Violation[];
  checked: number;
} {
  const tracked = execFileSync(
    'git',
    ['-c', 'core.quotePath=off', 'ls-files', '-z', '--', 'apps', 'libs'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
    .split('\0')
    .filter(isCounted);
  const exists = (path: string) => existsSync(posix.join(root, path));
  return {
    checked: tracked.length,
    violations: [
      ...submoduleViolations(tracked),
      ...tracked.flatMap((file) =>
        file.startsWith(WEB)
          ? componentViolations(
              file,
              readFileSync(posix.join(root, file), 'utf8'),
              exists,
            )
          : [],
      ),
    ],
  };
}

function parseBaseline(text: string, source: string): Baseline {
  let parsed: Partial<Baseline>;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${source} is not valid JSON`);
  }
  if (!RULES.every((rule) => Array.isArray(parsed[rule])))
    throw new Error(`${source} must hold "submodules" and "components" lists`);
  return parsed as Baseline;
}

function baseBaseline(ref: string): Baseline | null {
  let text: string;
  try {
    text = execFileSync('git', ['show', `${ref}:${BASELINE}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  return parseBaseline(text, `${ref}:${BASELINE}`);
}

function main() {
  const { values } = parseArgs({ options: { base: { type: 'string' } } });
  let errors: string[];
  let summary = '';
  try {
    if (!existsSync(BASELINE))
      throw new Error(
        `${BASELINE} is missing; it lists the violations allowed today`,
      );
    const baseline = parseBaseline(readFileSync(BASELINE, 'utf8'), BASELINE);
    const { violations, checked } = scanRepo('.');
    const base = values.base
      ? { baseline: baseBaseline(values.base), ref: values.base }
      : undefined;
    errors = baselineErrors(violations, baseline, base);
    const listed = baseline.submodules.length + baseline.components.length;
    summary = `structure: ${checked} files checked, ${listed} baselined, ok`;
  } catch (error) {
    errors = [(error as Error).message];
  }
  if (errors.length) {
    for (const line of errors) console.error(line);
    process.exit(1);
  }
  console.log(summary);
}

if (process.argv[1]?.endsWith('structure-check.ts')) main();
