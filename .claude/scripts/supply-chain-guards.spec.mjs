import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const yml = (path) => parse(read(path));

const workflows = {
  ci: yml('.github/workflows/ci.yml'),
  prQa: yml('.github/workflows/pr-qa.yml'),
  release: yml('.github/workflows/release.yml'),
  mutation: yml('.github/workflows/mutation.yml'),
  restoreDrill: yml('.github/workflows/restore-drill.yml'),
};
const setup = yml('.github/actions/setup/action.yml');

const steps = (workflow, job) => {
  const found = workflow.jobs[job]?.steps;
  assert.ok(found, `job ${job} not found`);
  return found;
};
const runText = (list) => list.map((s) => s.run ?? '').join('\n');
const setupStep = (list) => list.find((s) => s.uses === './.github/actions/setup');

describe('Dependabot', () => {
  const config = yml('.github/dependabot.yml');
  const entry = (ecosystem) => config.updates.find((u) => u['package-ecosystem'] === ecosystem);

  // @traces 1179-FR-001
  it('ignores Prisma majors and keeps the webpack-dev-server rule', () => {
    const ignore = entry('npm').ignore ?? [];
    for (const name of ['webpack-dev-server', 'prisma', '@prisma/*']) {
      const rule = ignore.find((r) => r['dependency-name'] === name);
      assert.ok(rule, `no ignore rule for ${name}`);
      assert.deepEqual(rule['update-types'], ['version-update:semver-major'], name);
    }
  });

  // @traces 1179-FR-001
  it('waits three days before proposing a new version, in every ecosystem', () => {
    for (const ecosystem of ['npm', 'github-actions']) {
      assert.equal(entry(ecosystem).cooldown?.['default-days'], 3, ecosystem);
    }
  });
});

describe('installs without lifecycle scripts', () => {
  // @traces 1179-FR-002
  it('every npm ci in the workflows and the setup action skips install scripts', () => {
    const texts = [
      runText(setup.runs.steps),
      ...Object.values(workflows).flatMap((w) => Object.values(w.jobs).map((j) => runText(j.steps ?? []))),
    ];
    const installs = texts.flatMap((t) => t.split('\n')).filter((l) => /\bnpm ci\b/.test(l));
    assert.ok(installs.length >= 4, `expected the install sites, found ${installs.length}`);
    for (const line of installs) assert.match(line, /--ignore-scripts/, line.trim());
  });

  // @traces 1179-FR-002
  it('every install that runs the code generates the Prisma client, then rebuilds sharp', () => {
    const sites = [
      ['setup action', runText(setup.runs.steps)],
      ['pr-qa qa', runText(steps(workflows.prQa, 'qa'))],
      ['mutation mutate', runText(steps(workflows.mutation, 'mutate'))],
    ];
    for (const [name, text] of sites) {
      const install = text.indexOf('npm ci --ignore-scripts');
      const generate = text.indexOf('prisma generate --config libs/domain/prisma.config.ts');
      const rebuild = text.indexOf('npm rebuild sharp');
      assert.ok(install >= 0 && generate > install && rebuild > generate, name);
    }
    for (const [workflow, job] of [
      [workflows.ci, 'unit'],
      [workflows.ci, 'integration'],
      [workflows.ci, 'e2e'],
      [workflows.restoreDrill, 'drill'],
    ]) {
      assert.ok(setupStep(steps(workflow, job)), `${job} installs through the setup action`);
    }
    assert.doesNotMatch(runText(steps(workflows.release, 'staging')), /npm rebuild|prisma generate/, 'staging');
  });

  // @traces 1179-FR-002
  it("the images' production install skips scripts and rebuilds only the Prisma engine and sharp", () => {
    const line = read('Dockerfile')
      .split('\n')
      .find((l) => /npm ci --omit=dev/.test(l));
    assert.ok(line, 'the production install line');
    assert.match(line, /npm ci --omit=dev --ignore-scripts/);
    assert.match(line, /npm rebuild @prisma\/engines sharp/);
  });
});

describe('dependency audit', () => {
  // @traces 1179-FR-003
  it('checks the registry signatures of the installed packages', () => {
    const audit = steps(workflows.ci, 'checks').find((s) => s.name === 'Dependency audit');
    assert.ok(audit, 'the Dependency audit step');
    assert.match(audit.run, /^npm audit signatures$/m);
  });
});
