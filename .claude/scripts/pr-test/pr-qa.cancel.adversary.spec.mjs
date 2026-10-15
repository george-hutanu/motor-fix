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

// pr-qa-workflow.spec.mjs pins the cancel step's condition, status and description; this pins what it does not.
describe('the step that runs when the lap is cancelled', () => {
  it('uses the same run address as the pending status it replaces', () => {
    const url = (s) => /RUN_URL: (.*)/.exec(s)?.[1].trim();
    assert.equal(url(stepNamed('agent-review error')), url(stepNamed('agent-review pending')));
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
