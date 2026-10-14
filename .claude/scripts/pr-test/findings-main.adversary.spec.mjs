import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { markPreExisting } from './findings.mjs';

const axe = (title, extra = {}) => ({ severity: 'high', kind: 'axe', title, route: '/', ...extra });
const consoleErr = (title, extra = {}) => ({ severity: 'high', kind: 'console', title, route: '/admin', ...extra });
const T = 'Accessibility (serious): label-content-name-mismatch — Elements must have their visible text as part of their accessible name (1 element)';

describe('accessibility and console findings that main already reported', () => {
  it('marks the same kind, title and route as pre-existing and caps high at medium', () => {
    const [f] = markPreExisting([axe(T)], [axe(T)]);
    assert.equal(f.severity, 'medium');
    assert.equal(f.preExisting, true);
  });

  it('caps a blocker at medium too', () => {
    const [f] = markPreExisting([axe(T, { severity: 'blocker' })], [axe(T)]);
    assert.equal(f.severity, 'medium');
  });

  it('never raises a low finding to medium', () => {
    const [f] = markPreExisting([axe(T, { severity: 'low' })], [axe(T)]);
    assert.equal(f.severity, 'low');
    assert.equal(f.preExisting, true);
  });

  it('keeps the PR\'s own when the element count in the title differs', () => {
    const more = T.replace('(1 element)', '(2 elements)');
    const [f] = markPreExisting([axe(more)], [axe(T)]);
    assert.equal(f.severity, 'high');
    assert.notEqual(f.preExisting, true);
  });

  it('keeps the PR\'s own on another route with the same title', () => {
    const [f] = markPreExisting([axe(T, { route: '/cockpit' })], [axe(T)]);
    assert.equal(f.severity, 'high');
    assert.notEqual(f.preExisting, true);
  });

  it('does not match an axe finding against a console finding with the same title and route', () => {
    const [f] = markPreExisting([consoleErr('x', { route: '/' })], [axe('x')]);
    assert.equal(f.severity, 'high');
    assert.notEqual(f.preExisting, true);
  });

  it('marks a console 401 main also reported', () => {
    const t = 'Console error: Failed to load resource: the server responded with a status of 401 ()';
    const [f] = markPreExisting([consoleErr(t)], [consoleErr(t)]);
    assert.equal(f.severity, 'medium');
    assert.equal(f.preExisting, true);
  });

  it('treats an empty baseline as vouching for nothing', () => {
    const [f] = markPreExisting([axe(T), consoleErr('c')], []).slice(0, 1);
    assert.equal(f.severity, 'high');
  });

  it('leaves other kinds with a matching key as they are', () => {
    const step = { severity: 'blocker', kind: 'step', title: 'Flow failed', route: '/' };
    const [f] = markPreExisting([step], [step]);
    assert.equal(f.severity, 'blocker');
    assert.notEqual(f.preExisting, true);
  });

  it('matches a title with non-ASCII characters exactly and not under normalisation', () => {
    const composed = 'Console error: Programează ș';
    const decomposed = 'Console error: Programează ș'.normalize('NFD');
    const [f] = markPreExisting([consoleErr(decomposed)], [consoleErr(composed)]);
    assert.equal(f.severity, 'high');
    const [g] = markPreExisting([consoleErr(composed)], [consoleErr(composed)]);
    assert.equal(g.severity, 'medium');
  });

  it('does not mutate the findings or the baseline it was given', () => {
    const mine = [axe(T)];
    const base = [axe(T)];
    markPreExisting(mine, base);
    assert.equal(mine[0].severity, 'high');
    assert.equal(mine[0].preExisting, undefined);
  });

  it('marks every duplicate of the same key', () => {
    const out = markPreExisting([axe(T), axe(T)], [axe(T)]);
    assert.deepEqual(out.map((f) => f.severity), ['medium', 'medium']);
  });

  it('survives ten thousand findings against a ten thousand entry baseline', () => {
    const list = Array.from({ length: 10000 }, (_, i) => axe(`t${i}`));
    const out = markPreExisting(list, list);
    assert.equal(out.every((f) => f.severity === 'medium'), true);
  });
});
