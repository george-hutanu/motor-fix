// @traces 1230-FR-002 1230-FR-009
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const text = readFileSync(join(import.meta.dirname, '..', '..', '..', '.github', 'workflows', 'pr-qa.yml'), 'utf8');

const stepNamed = (fragment) => {
  const parts = text.split(/\n      - /);
  const step = parts.find((p) => p.includes(`name: ${fragment}`));
  assert.ok(step, `no step named like ${fragment}`);
  return step;
};

describe('the step that runs when the lap is cancelled', () => {
  const step = () => stepNamed('agent-review error');

  it('runs on cancellation only', () => {
    assert.match(step(), /\n\s+if: cancelled\(\)\s*\n/);
  });

  it('sets state error with the description the spec names and the run\'s own target url', () => {
    const s = step();
    assert.match(s, /state=error/);
    assert.match(s, /context=agent-review/);
    assert.ok(s.includes('description="PR QA lap cancelled"'), 'description is not "PR QA lap cancelled"');
    assert.match(s, /target_url="\$RUN_URL"/);
  });

  it('uses the same run address as the pending status it replaces', () => {
    const pending = stepNamed('agent-review pending');
    const url = (s) => /RUN_URL: (.*)/.exec(s)?.[1].trim();
    assert.equal(url(step()), url(pending));
  });

  it('reads the head\'s combined status and compares the target url with the run\'s before writing', () => {
    const s = step();
    const read = s.indexOf('commits/$SHA/status');
    const write = s.indexOf('statuses/$SHA');
    assert.ok(read !== -1 && write !== -1 && read < write);
    assert.match(s, /\[ "\$owner" = "\$RUN_URL" \]/);
  });

  it('leaves a status it does not own without failing the job', () => {
    assert.match(step(), /not this run's[^\n]*exit 0/);
  });

  it('writes the verdict step only when not cancelled', () => {
    assert.match(stepNamed('agent-review success or failure'), /if: \$\{\{ !cancelled\(\)/);
  });

  it('has permission to write statuses', () => {
    assert.match(text, /statuses: write/);
  });
});

describe('the routes check', () => {
  it('lets ? = & and % through and still stops quoting characters', () => {
    const rule = /\[\[ "\$ROUTES" =~ (\^\/[^ ]*\$) \]\]/.exec(text)?.[1];
    assert.ok(rule);
    const re = new RegExp(rule.replace(/\\&/g, '&'));
    for (const ok of ['/r?a=b&c=d%20e', '/:lang/x:404']) assert.equal(re.test(ok), true, ok);
    for (const bad of ['/a"b', "/a'b", '/a b', '/a;b', '/a$b', '/a`b', '/a|b', '/a>b']) assert.equal(re.test(bad), false, bad);
  });
});
