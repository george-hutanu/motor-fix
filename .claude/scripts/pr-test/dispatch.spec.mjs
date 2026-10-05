import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import {
  ARTIFACT_PREFIX,
  FLOWS_LIMIT,
  WORKFLOW,
  artifactName,
  checkReport,
  dispatchCommand,
  dispatchInputs,
  encodeFlows,
  findRun,
  parseArgs,
} from './dispatch.mjs';

const SHA = 'a'.repeat(40);

describe('dispatch: arguments', () => {
  it('reads the PR, the flows, the routes, the lap, the output and the ref', () => {
    const o = parseArgs(['62', '--flows', 'f.mjs', '--routes', '/,/cockpit,/app', '--lap', '2', '--out', '/tmp/x', '--ref', 'chore-x']);
    assert.deepEqual(o, { pr: '62', flows: 'f.mjs', routes: '/,/cockpit,/app', lap: '2', out: '/tmp/x', ref: 'chore-x' });
  });

  it('dispatches on main, lap 1, the default routes, without flows', () => {
    assert.deepEqual(parseArgs(['7']), { pr: '7', flows: undefined, routes: '/,/cockpit', lap: '1', out: undefined, ref: 'main' });
  });
});

describe('dispatch: the flows file travels as a workflow input', () => {
  it('is gzipped, then base64, and decodes back to the same text', () => {
    const text = `export default async () => [];\n// ${'ș'.repeat(500)}\n`;
    const encoded = encodeFlows(text);
    assert.match(encoded, /^[A-Za-z0-9+/]+=*$/);
    assert.equal(gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8'), text);
  });

  it('refuses a file whose encoding would not fit GitHub\'s input limit, and says what to do', () => {
    assert.ok(FLOWS_LIMIT < 65535);
    const big = randomBytes(FLOWS_LIMIT).toString('hex');
    assert.throws(() => encodeFlows(big), /too large.*--local/s);
  });

  it('sends every input as a string, the flows empty when there are none', () => {
    const inputs = dispatchInputs({ pr: 62, sha: SHA, lap: 1, routes: '/,/cockpit', flows: null, nonce: 'n1' });
    assert.deepEqual(inputs, { pr: '62', sha: SHA, lap: '1', routes: '/,/cockpit', flows: '', nonce: 'n1' });
  });

  it('pins the run to the commit it was asked about', () => {
    assert.throws(() => dispatchInputs({ pr: 62, sha: 'abc1234', lap: 1, routes: '/', flows: null, nonce: 'n' }), /40/);
  });

  it('passes the inputs on stdin, never on the command line', () => {
    const { args, input } = dispatchCommand({ ref: 'main', inputs: { pr: '62', flows: 'x'.repeat(50000) } });
    assert.deepEqual(args, ['workflow', 'run', WORKFLOW, '--ref', 'main', '--json']);
    assert.equal(JSON.parse(input).flows.length, 50000);
  });
});

describe('dispatch: finding the run and its evidence', () => {
  it('finds the dispatched run by the nonce in its name', () => {
    const runs = [
      { databaseId: 1, displayTitle: 'PR QA #62 at aaa lap 1 62-aaaaaaa-old', url: 'u1' },
      { databaseId: 2, displayTitle: 'PR QA #62 at aaa lap 1 62-aaaaaaa-new', url: 'u2' },
    ];
    assert.equal(findRun(runs, '62-aaaaaaa-new').databaseId, 2);
    assert.equal(findRun(runs, 'missing'), null);
  });

  it('names the artifact the way the workflow uploads it', () => {
    assert.equal(artifactName(62), `${ARTIFACT_PREFIX}62`);
  });

  it('accepts a report about the commit it dispatched, and nothing else', () => {
    assert.equal(checkReport({ sha: SHA, verdict: 'success' }, SHA), null);
    assert.match(checkReport(null, SHA), /no report/);
    assert.match(checkReport({ sha: 'b'.repeat(40), verdict: 'success' }, SHA), /bbbbbbb/);
    assert.match(checkReport({ sha: SHA }, SHA), /verdict/);
  });

  it('never reads a cancelled run as a verdict, even when it left a report', () => {
    assert.match(checkReport({ sha: SHA, verdict: 'failure' }, SHA, 'cancelled'), /cancelled/);
    assert.match(checkReport({ sha: SHA, verdict: 'success' }, SHA, 'cancelled'), /cancelled/);
    assert.equal(checkReport({ sha: SHA, verdict: 'failure' }, SHA, 'failure'), null);
  });
});
