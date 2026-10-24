import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path) => readFileSync(`${root}${path}`, 'utf8');
const yml = (path) => parse(read(path));

const workflowFiles = readdirSync(`${root}.github/workflows`)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => `.github/workflows/${f}`);
const actionFiles = readdirSync(`${root}.github/actions`)
  .map((d) => `.github/actions/${d}/action.yml`)
  .filter((f) => existsSync(`${root}${f}`));

const commands = (text) =>
  text
    .replace(/\\\r?\n/g, ' ')
    .split(/\r?\n|&&|;|\|\||\||\(|\)/)
    .map((c) => c.trim())
    .filter((c) => c && !c.startsWith('#'));

const jobsOf = (file) => Object.entries(yml(file).jobs ?? {});
const runs = (steps) => (steps ?? []).map((s) => s.run ?? '').join('\n');
const INSTALL = /\bnpm\s+(ci|clean-install|install-ci-test|cit|ic|install|i|add|isntall|update|up)\b/;
const GLOBAL = /(\s--global\b|\s-g\b)/;

describe('every install site, found by scanning rather than by name', () => {
  // @traces 1179-FR-002
  it('no workflow or action step runs an npm install form without --ignore-scripts, except a global tool', () => {
    const offenders = [];
    const sites = [];
    for (const file of workflowFiles) {
      for (const [job, def] of jobsOf(file)) {
        for (const c of commands(runs(def.steps))) {
          if (INSTALL.test(c) && !GLOBAL.test(c)) {
            sites.push(`${file}:${job}`);
            if (!/--ignore-scripts\b/.test(c)) offenders.push(`${file}:${job}: ${c}`);
          }
        }
      }
    }
    for (const file of actionFiles) {
      for (const c of commands(runs(yml(file).runs?.steps))) {
        if (INSTALL.test(c) && !GLOBAL.test(c) && !/--ignore-scripts\b/.test(c)) offenders.push(`${file}: ${c}`);
      }
    }
    assert.ok(sites.length >= 3, `found only ${sites.length} install sites`);
    assert.deepEqual(offenders, []);
  });

  // @traces 1179-FR-002
  it('no other package manager installs the lockfile in a workflow', () => {
    const hits = [];
    for (const file of workflowFiles) {
      for (const [job, def] of jobsOf(file)) {
        for (const c of commands(runs(def.steps))) {
          if (/^(yarn|pnpm|bun)(\s+(install|i|add))?(\s|$)/.test(c) && !/--ignore-scripts/.test(c)) hits.push(`${file}:${job}: ${c}`);
        }
      }
    }
    assert.deepEqual(hits, []);
  });

  // @traces 1179-FR-002
  it('nothing re-enables scripts through the environment', () => {
    const files = [...workflowFiles, ...actionFiles];
    const hits = files.filter((f) => /(npm_config_ignore_scripts|NPM_CONFIG_IGNORE_SCRIPTS)\s*[:=]\s*["']?(false|0)\b/i.test(read(f)));
    assert.deepEqual(hits, []);
    assert.doesNotMatch(read('Dockerfile'), /NPM_CONFIG_IGNORE_SCRIPTS\s*=\s*"?(false|0)/i);
    assert.doesNotMatch(existsSync(`${root}.npmrc`) ? read('.npmrc') : '', /ignore-scripts\s*=\s*false/i);
  });

  // @traces 1179-FR-002
  it('an npm rebuild never runs bare and only names sharp in workflows', () => {
    const offenders = [];
    for (const file of workflowFiles) {
      for (const [job, def] of jobsOf(file)) {
        for (const c of commands(runs(def.steps))) {
          const m = c.match(/\bnpm\s+rebuild\b(.*)$/);
          if (m && m[1].trim() !== 'sharp') offenders.push(`${file}:${job}: ${c}`);
        }
      }
    }
    assert.deepEqual(offenders, []);
  });

  // @traces 1179-FR-002
  it('the setup action rebuilds only sharp, after its install, and never lets a step fail quietly', () => {
    const list = yml('.github/actions/setup/action.yml').runs.steps;
    const text = runs(list);
    const install = text.search(/\bnpm\s+ci\b/);
    const rebuild = text.search(/\bnpm\s+rebuild\s+sharp\s*$/m);
    assert.ok(install >= 0 && rebuild > install);
    for (const s of list) assert.notEqual(s['continue-on-error'], true, JSON.stringify(s));
  });
});

describe('jobs get what the skipped postinstall used to give them', () => {
  const installs = (def) =>
    (def.steps ?? []).some((s) => s.uses === './.github/actions/setup' || /\bnpm\s+ci\b/.test(s.run ?? ''));

  // @traces 1179-FR-002
  it('every job that installs and runs nx, jest, tsc or prisma has the client generated', () => {
    const offenders = [];
    for (const file of workflowFiles) {
      for (const [job, def] of jobsOf(file)) {
        if (!installs(def)) continue;
        if (file.endsWith('release.yml') && job === 'staging') continue;
        const text = runs(def.steps);
        const needs = commands(text).some((c) => /(^|\s)(npx\s+)?(nx|jest|tsc|prisma)\b/.test(c) && !/prisma\s+generate/.test(c) && !/playwright/.test(c));
        const viaSetup = (def.steps ?? []).some((s) => s.uses === './.github/actions/setup');
        const generated = /prisma\s+generate\b/.test(text);
        if (needs && !viaSetup && !generated) offenders.push(`${file}:${job}`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  // @traces 1179-FR-002
  it('where a job both installs by hand and generates, the generate comes after the install', () => {
    const offenders = [];
    for (const file of workflowFiles) {
      for (const [job, def] of jobsOf(file)) {
        const text = runs(def.steps).replace(/\\\r?\n/g, ' ');
        const i = text.search(/\bnpm\s+ci\b/);
        const g = text.search(/prisma\s+generate\b/);
        if (i >= 0 && g >= 0 && g < i) offenders.push(`${file}:${job}`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  // @traces 1179-FR-002
  it('every job that runs unit, integration, e2e or mutation tests rebuilds sharp, except staging against a deployed target', () => {
    const offenders = [];
    for (const file of workflowFiles) {
      for (const [job, def] of jobsOf(file)) {
        if (file.endsWith('release.yml') && job === 'staging') continue;
        if (!installs(def)) continue;
        const text = runs(def.steps);
        const runsTests = commands(text).some((c) => /(\s-t\s+(test|e2e)\b|:test\b|:test:mutation|:e2e\b|\bstryker\b)/.test(c));
        const rebuilt =
          /npm\s+rebuild\s+sharp/.test(text) || (def.steps ?? []).some((s) => s.uses === './.github/actions/setup');
        if (runsTests && !rebuilt) offenders.push(`${file}:${job}`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  // @traces 1179-FR-002
  it('every job that rebuilds sharp does so after its install', () => {
    const offenders = [];
    for (const file of workflowFiles) {
      for (const [job, def] of jobsOf(file)) {
        const text = runs(def.steps).replace(/\\\r?\n/g, ' ');
        const r = text.search(/npm\s+rebuild\b/);
        const i = text.search(/\bnpm\s+ci\b/);
        if (r >= 0 && i >= 0 && r < i) offenders.push(`${file}:${job}`);
        if (r >= 0 && i < 0 && !(def.steps ?? []).some((s) => s.uses === './.github/actions/setup')) offenders.push(`${file}:${job} rebuilds with no install`);
      }
    }
    assert.deepEqual(offenders, []);
  });
});

describe('the image build', () => {
  const lines = () => read('Dockerfile').replace(/\\\r?\n/g, ' ').split(/\r?\n/);

  // @traces 1179-FR-002
  it('every npm install form in the Dockerfile skips scripts', () => {
    const offenders = [];
    let seen = 0;
    for (const l of lines()) {
      for (const c of commands(l.replace(/^\s*RUN\s+/i, ''))) {
        if (INSTALL.test(c) && !GLOBAL.test(c)) {
          seen += 1;
          if (!/--ignore-scripts\b/.test(c)) offenders.push(c);
        }
      }
    }
    assert.ok(seen >= 2, `found ${seen} installs`);
    assert.deepEqual(offenders, []);
  });

  // @traces 1179-FR-002
  it('no npm rebuild in the Dockerfile runs bare or names more than the engine and sharp', () => {
    const offenders = [];
    for (const l of lines()) {
      for (const c of commands(l)) {
        const m = c.match(/\bnpm\s+rebuild\b(.*)$/);
        if (m && m[1].trim() !== '@prisma/engines sharp') offenders.push(c);
      }
    }
    assert.deepEqual(offenders, []);
  });

  // @traces 1179-FR-002
  it('the build stage generates the client after its install', () => {
    const text = lines().join('\n');
    const i = text.search(/npm ci --ignore-scripts/);
    const g = text.search(/prisma generate --config libs\/domain\/prisma\.config\.ts/);
    assert.ok(i >= 0 && g > i);
  });
});

describe('the dependency audit fails the step on a signatures error', () => {
  const audit = () => {
    const wf = yml('.github/workflows/ci.yml');
    const found = Object.entries(wf.jobs).flatMap(([job, def]) =>
      (def.steps ?? []).filter((s) => /npm audit signatures/.test(s.run ?? '')).map((s) => ({ job, step: s, def })),
    );
    return found;
  };

  // @traces 1179-FR-003
  it('exactly one step runs it, and it is a live command, not a comment or an echo', () => {
    const found = audit();
    assert.equal(found.length, 1);
    const cmds = commands(found[0].step.run);
    assert.ok(cmds.includes('npm audit signatures'), JSON.stringify(cmds));
  });

  // @traces 1179-FR-003
  it('nothing swallows its exit code', () => {
    const { step, def } = audit()[0];
    assert.notEqual(step['continue-on-error'], true);
    assert.notEqual(def['continue-on-error'], true);
    const text = step.run.replace(/\\\r?\n/g, ' ');
    const line = text.split('\n').find((l) => /npm audit signatures/.test(l));
    assert.doesNotMatch(line, /\|\||\|\s|;\s*true|&\s*$|>\s*\/dev\/null\s*2>&1\s*$/);
    assert.doesNotMatch(text, /set\s+\+e|\|\|\s*(true|:|exit\s+0)|\bif\b[^\n]*npm audit signatures/);
  });

  // @traces 1179-FR-003
  it('runs after the install, before the dry-run install, and on every pull request', () => {
    const { job, step, def } = audit()[0];
    const idx = def.steps.indexOf(step);
    assert.ok(def.steps.slice(0, idx).some((s) => s.uses === './.github/actions/setup'), 'node_modules must exist first');
    const cmds = commands(step.run);
    assert.ok(cmds.indexOf('npm audit signatures') < cmds.findIndex((c) => /npm install --dry-run/.test(c)));
    assert.ok(!/^\s*(false|0|'')\s*$/.test(String(def.if ?? 'true')), `${job} job is switched off`);
    assert.ok(!/(^|\s)(false|0)(\s|$)/.test(String(step.if ?? '')), String(step.if));
  });

  // @traces 1179-FR-003
  it('the vulnerability audit and the dry-run install are still there', () => {
    const cmds = commands(audit()[0].step.run);
    assert.ok(cmds.includes('npm audit --omit=dev --audit-level=high'), JSON.stringify(cmds));
    assert.ok(cmds.some((c) => /^npm install --dry-run --ignore-scripts\b/.test(c)));
  });
});

describe('Dependabot configuration, as Dependabot reads it', () => {
  const config = yml('.github/dependabot.yml');

  // @traces 1179-FR-001
  it('every update entry carries an integer cooldown of at least 3 days and none of its semver overrides is lower', () => {
    assert.ok(config.updates.length >= 2);
    for (const u of config.updates) {
      const c = u.cooldown;
      assert.ok(c, `${u['package-ecosystem']} has no cooldown`);
      assert.ok(Number.isInteger(c['default-days']) && c['default-days'] >= 3 && c['default-days'] <= 90, JSON.stringify(c));
      for (const k of ['semver-major-days', 'semver-minor-days', 'semver-patch-days']) {
        if (k in c) assert.ok(Number.isInteger(c[k]) && c[k] >= 3, `${u['package-ecosystem']} ${k}=${c[k]}`);
      }
    }
  });

  // @traces 1179-FR-001
  it('the cooldown does not exempt prisma through include or exclude lists', () => {
    for (const u of config.updates) {
      const c = u.cooldown ?? {};
      assert.equal(c.include, undefined, 'include narrows the cooldown to a few packages');
      const ex = c.exclude ?? [];
      assert.deepEqual(ex.filter((n) => /prisma|\*/.test(n)), []);
    }
  });

  // @traces 1179-FR-001
  it('every npm entry ignores prisma and @prisma/* majors exactly once, with no version list that overrides it', () => {
    const npm = config.updates.filter((u) => u['package-ecosystem'] === 'npm');
    assert.ok(npm.length >= 1);
    for (const u of npm) {
      for (const name of ['prisma', '@prisma/*']) {
        const rules = (u.ignore ?? []).filter((r) => r['dependency-name'] === name);
        assert.equal(rules.length, 1, `${name} in ${u.directory}`);
        assert.deepEqual(rules[0]['update-types'], ['version-update:semver-major']);
        assert.equal(rules[0].versions, undefined);
      }
    }
  });

  // @traces 1179-FR-001
  it('no rule in the file lets Prisma 8 through by a different glob or by an allow list', () => {
    for (const u of config.updates) {
      const allow = u.allow ?? [];
      for (const a of allow) {
        assert.doesNotMatch(String(a['dependency-name'] ?? ''), /prisma/i, 'allow rule names prisma');
        assert.notEqual(a['dependency-type'], 'all', 'allow all re-opens majors');
      }
      for (const r of u.ignore ?? []) {
        if (/prisma/.test(r['dependency-name'])) {
          assert.ok(!(r['update-types'] ?? []).includes('version-update:semver-minor'), 'ignoring minors would freeze 7.x');
        }
      }
    }
  });

  // @traces 1179-FR-001
  it('a prisma dependency in package.json is not already at 8 or above', () => {
    const pkg = JSON.parse(read('package.json'));
    const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
    const prisma = Object.entries(all).filter(([n]) => n === 'prisma' || n.startsWith('@prisma/'));
    assert.ok(prisma.length >= 2);
    for (const [n, v] of prisma) assert.match(v, /^[~^]?7\./, `${n}@${v}`);
  });

  // @traces 1179-FR-001
  it('the ecosystems in the file are all ones whose entries carry the same guard, including any added later', () => {
    const seen = config.updates.map((u) => u['package-ecosystem']);
    assert.deepEqual([...new Set(seen)].sort(), ['github-actions', 'npm']);
  });
});
