import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import { appEnv } from './services.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const text = readFileSync(join(ROOT, '.github', 'workflows', 'pr-qa.yml'), 'utf8');
const lines = text.split('\n');

/** The value of the first `key:` line at `indent`, read from the text so a file GitHub would reject can still be probed. */
const scalar = (key, indent) => {
  const prefix = `${' '.repeat(indent)}${key}: `;
  const line = lines.find((l) => l.startsWith(prefix));
  assert.ok(line, `${key} at indent ${indent}`);
  return line.slice(prefix.length);
};
const workflow = { concurrency: { group: scalar('group', 2) } };
const job = { if: scalar('if', 4) };

const strip = (expr) => String(expr).replace(/^\s*\$\{\{\s*/, '').replace(/\s*\}\}\s*$/, '');

/** Evaluates a workflow expression of the shapes pr-qa.yml uses against a hand-built event context. */
function evaluate(expr, ctx) {
  const lookup = (path) => (path in ctx ? ctx[path] : undefined);
  const js = strip(expr)
    .replace(/\b(github|inputs)(?:\.(?:[A-Za-z_*]+))+/g, (m) => `v(${JSON.stringify(m)})`)
    .replace(/\bcontains\(/g, 'contains(')
    .replace(/\bformat\(/g, 'format(');
  const contains = (haystack, needle) => (Array.isArray(haystack) ? haystack.includes(needle) : String(haystack ?? '').includes(needle));
  const format = (fmt, ...args) => fmt.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)]));
  return new Function('v', 'contains', 'format', `return (${js});`)(lookup, contains, format);
}

const dispatchEvent = (pr = '62', run = 1) => ({
  'github.event_name': 'workflow_dispatch',
  'inputs.pr': pr,
  'github.run_id': run,
});
const pullRequestEvent = ({ labels = [], draft = false, repo = 'george-hutanu/motor-fix', number = 62, run = 1 } = {}) => ({
  'github.event_name': 'pull_request',
  'github.event.pull_request.number': number,
  'github.event.pull_request.draft': draft,
  'github.event.pull_request.head.repo.full_name': repo,
  'github.event.pull_request.labels.*.name': labels,
  'github.repository': 'george-hutanu/motor-fix',
  'github.run_id': run,
});

const group = (ctx) => evaluate(workflow.concurrency.group, ctx);
const runs = (ctx) => Boolean(evaluate(job.if, ctx));

describe('the workflow file', () => {
  // @traces 1361-FR-006
  it('is valid YAML, which GitHub requires before it runs a single event', () => {
    assert.doesNotThrow(() => parse(text));
  });
});

describe('a pull_request event without the qa: on-push label', () => {
  // @traces 1361-FR-006
  it('takes a group of its own per run, so it never shares the dispatched lap\'s group', () => {
    assert.equal(group(dispatchEvent('62', 10)), 'pr-qa-62');
    const first = group(pullRequestEvent({ run: 11 }));
    const second = group(pullRequestEvent({ run: 12 }));
    assert.equal(first, 'pr-qa-skip-11');
    assert.equal(second, 'pr-qa-skip-12');
    assert.notEqual(first, group(dispatchEvent('62', 10)));
  });

  // @traces 1361-FR-006
  it('does not run the job, ready or not, whatever other labels it carries', () => {
    for (const labels of [[], ['QA'], ['planning', 'feature', 'ui'], ['qa: on-push-later'], ['qa:on-push'], ['on-push'], ['qa: on-pus']]) {
      const ctx = pullRequestEvent({ labels });
      assert.equal(runs(ctx), false, JSON.stringify(labels));
      assert.equal(group(ctx), 'pr-qa-skip-1', JSON.stringify(labels));
    }
  });

});

describe('a pull_request event with the qa: on-push label', () => {
  // @traces 1361-FR-006
  it('joins the PR\'s one group and runs when it is ready and from this repository', () => {
    const ctx = pullRequestEvent({ labels: ['QA', 'qa: on-push'], number: 91 });
    assert.equal(runs(ctx), true);
    assert.equal(group(ctx), 'pr-qa-91');
  });

});

describe('a dispatched run', () => {
  // @traces 1361-FR-006
  it('always runs, in the group of its PR, whatever the pull_request fields hold', () => {
    assert.equal(runs(dispatchEvent('62')), true);
    assert.equal(group(dispatchEvent('62')), 'pr-qa-62');
    assert.equal(group(dispatchEvent('7', 99)), 'pr-qa-7');
  });

});

describe('the sign-in limit flag', () => {
  // @traces 1361-FR-008
  it('is set once, to the literal 1, in the PR QA job and no workflow input can carry it', () => {
    assert.equal(scalar('PR_QA_SIGN_IN_UNLIMITED', 6), "'1'");
    const inputs = lines.slice(lines.indexOf('  workflow_dispatch:'), lines.indexOf('permissions:')).filter((l) => /^ {6}[a-z]+:\s*$/.test(l));
    assert.equal(inputs.some((l) => /sign|limit|unlimited/i.test(l)), false);
    assert.equal(text.split('PR_QA_SIGN_IN_UNLIMITED').length - 1, 1, 'one entry in the job env, nothing else');
  });

  // @traces 1361-FR-008
  it('appears nowhere that boots staging, production or a developer\'s stack with a value', () => {
    const found = spawnSync('git', ['-c', 'submodule.recurse=false', '-C', ROOT, 'grep', '--untracked', '-I', '-n', 'PR_QA_SIGN_IN_UNLIMITED', '--', '.', ':!*.spec.ts', ':!*.spec.mjs'], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
    const outside = found.filter((l) => !/^(\.github\/workflows\/pr-qa\.yml|\.env\.example|libs\/domain\/src\/auth\/|specs\/|\.specify\/capabilities\/|\.claude\/scripts\/pr-test\/)/.test(l));
    assert.deepEqual(outside, []);
    const example = found.filter((l) => /^\.env\.example:\d+:PR_QA_SIGN_IN_UNLIMITED=/.test(l));
    assert.deepEqual(
      example.map((l) => l.split('PR_QA_SIGN_IN_UNLIMITED=')[1]),
      [''],
    );
  });

});
