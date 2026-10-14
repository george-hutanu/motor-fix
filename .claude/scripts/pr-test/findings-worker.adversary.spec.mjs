import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { workerCacheOutcome } from './findings.mjs';

const url = 'http://127.0.0.1:4000/ngsw-worker.js';
const check = (status, cacheControl) => workerCacheOutcome({ status, cacheControl, url });

describe('the worker cache check on odd headers', () => {
  it.each([
    'No-Cache',
    'NO-CACHE',
    'no-cache, max-age=0',
    'max-age=0, no-cache',
    'no-cache, no-store',
    'private, no-cache',
    'no-cache,must-revalidate',
  ])('passes %s', (cc) => {
    assert.deepEqual(check(200, cc), {});
  });

  it.each([
    'no-cache, MAX-AGE=60',
    'no-cache, max-age=1',
    'no-cache, s-maxage=600, max-age=5',
    'no-cache, Immutable',
    'Immutable, no-cache',
    'max-age=31536000, no-cache',
    'no-cache, max-age=00060',
    'no-cache,max-age=60',
  ])('blocks %s', (cc) => {
    assert.equal(check(200, cc).finding?.severity, 'high');
  });

  it.each([
    'max-age=0',
    'no-store',
    'must-revalidate',
    'public',
    'x-no-cache',
    'no-cache-please',
    'nocache',
  ])('blocks %s because no-cache is absent', (cc) => {
    assert.equal(check(200, cc).finding?.severity, 'high');
  });

  it.each([201, 204, 206, 301, 304, 500, '200', undefined, null, NaN])('blocks status %s', (s) => {
    assert.equal(check(s, 'no-cache').finding?.severity, 'high');
  });

  it('does not throw on an array header value', () => {
    assert.equal(check(200, ['no-cache']).finding, undefined);
  });

  it('names the status and header it saw in the finding', () => {
    const { finding } = check(200, 'public, max-age=60');
    assert.ok(finding.steps[0].includes('200'));
    assert.ok(finding.steps[0].includes('public, max-age=60'));
    assert.equal(finding.kind, 'step');
  });

  it('answers the same call the same way twice', () => {
    assert.deepEqual(check(200, 'no-cache'), check(200, 'no-cache'));
    assert.deepEqual(check(500, 'x'), check(500, 'x'));
  });
});
