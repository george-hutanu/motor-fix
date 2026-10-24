import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { carryLookup } from './watch.mjs';

// @traces 448-merge-gate-graphql-FR-008
// collect stays synchronous, and findCarry answers with a promise: the watch
// reaches the one carry reader through `carry.mjs <pr> --find` in a child.
describe('watch — the default carry lookup', () => {
  const CLI = fileURLToPath(new URL('./pr-test/carry.mjs', import.meta.url));
  const FOUND = { from: 'a'.repeat(40), head: 'c'.repeat(40), kind: 'docs' };

  it('runs carry.mjs <pr> --find under this node and returns its JSON', () => {
    const calls = [];
    const run = (file, args, opts) => (calls.push({ file, args, opts }), `${JSON.stringify(FOUND)}\n`);
    assert.deepEqual(carryLookup(21, { run }), FOUND);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].file, process.execPath);
    assert.deepEqual(calls[0].args, [CLI, '21', '--find']);
    assert.ok(calls[0].opts.timeout > 0, 'a hung gh cannot hold the watch');
  });

  it('passes a reason through, as findCarry gave it', () => {
    const run = () => JSON.stringify({ head: FOUND.head, reason: 'no agent-review success in the 10 commits before head' });
    assert.match(carryLookup(21, { run }).reason, /no agent-review success/);
  });

  it('throws when the child fails or prints no JSON object, which collect reads as no carry', () => {
    assert.throws(() => carryLookup(21, { run: () => { throw new Error('exit 2: HTTP 502'); } }), /HTTP 502/);
    assert.throws(() => carryLookup(21, { run: () => 'not json' }));
    assert.throws(() => carryLookup(21, { run: () => 'null' }), /no carry answer/);
    assert.throws(() => carryLookup(21, { run: () => '[1]' }), /no carry answer/);
  });
});
