import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { findingKey, layoutKey, markPreExisting, mergeFindings, sweepFinding, verdict } from './findings.mjs';

const where = { route: '/', viewport: 'mobile', scheme: 'light', lang: 'ro', size: '390x844', screenshot: 'shots/home.png' };
const obs = (rule, extra = {}) => ({ ...where, kind: 'layout', rule, selector: 'p#body13', measured: '13px', expected: '16px (phone body)', text: 'Programează', ...extra });
const find = (rule, extra, web = true) => sweepFinding(obs(rule, extra), { web });

describe('layout severities', () => {
  it('rates every rule per the rubric on a web change and caps all of them at medium otherwise', () => {
    const high = ['min-text', 'type-scale', 'clipped', 'grid'];
    const medium = ['tap-target', 'overlap', 'stretched-image', 'font-fallback', 'focus-ring'];
    for (const r of high) assert.equal(find(r).severity, 'high', r);
    for (const r of medium) assert.equal(find(r).severity, 'medium', r);
    for (const r of [...high, ...medium]) {
      const f = find(r, {}, false);
      assert.equal(f.severity, 'medium', r);
      assert.equal(f.preExisting, true, r);
    }
  });

  it('rates an unknown rule medium and never throws on a bare observation', () => {
    assert.equal(find('made-up').severity, 'medium');
    const f = sweepFinding({ kind: 'layout', rule: 'grid', selector: 'div' }, { web: true });
    assert.equal(f.severity, 'high');
    assert.equal(typeof f.title, 'string');
  });

  it('titles a layout finding as rule, selector, measured and expected', () => {
    assert.equal(find('min-text').title, 'Layout (min-text): p#body13 "Programează" — measured 13px, expected 16px (phone body)');
  });

  it('carries selector, measured, expected and the screenshot as evidence on the finding', () => {
    const f = find('grid', { selector: 'div#row', measured: 'gap 13px', expected: 'a multiple of 4px' });
    assert.equal(f.selector, 'div#row');
    assert.equal(f.measured, 'gap 13px');
    assert.equal(f.expected, 'a multiple of 4px');
    assert.equal(f.evidence, 'shots/home.png');
    assert.equal(f.route, '/');
  });

  it('blocks the verdict for a high layout finding on a web change and not on a change with no web code', () => {
    assert.equal(verdict([find('min-text')]), 'failure');
    assert.equal(verdict([find('min-text', {}, false)]), 'success');
    assert.equal(verdict([find('tap-target')]), 'success');
  });
});

describe('layoutKey', () => {
  it('ignores what was measured, the viewport, scheme and language', () => {
    assert.equal(layoutKey(find('grid', { measured: 'gap 14px', viewport: 'desktop', scheme: 'dark', lang: 'en' })), layoutKey(find('grid')));
  });

  it('differs by route, rule and selector', () => {
    const k = layoutKey(find('grid'));
    assert.notEqual(layoutKey(find('grid', { route: '/cockpit' })), k);
    assert.notEqual(layoutKey(find('overlap')), k);
    assert.notEqual(layoutKey(find('grid', { selector: 'div#other' })), k);
  });

  it('cannot be forged by a pipe in the selector or route', () => {
    const a = { kind: 'layout', route: '/a|grid', rule: 'x', selector: 'y' };
    const b = { kind: 'layout', route: '/a', rule: 'grid|x', selector: 'y' };
    assert.notEqual(layoutKey(a), layoutKey(b));
  });

  it('is what findingKey returns for a layout finding without an explicit key', () => {
    const f = find('grid');
    assert.equal(findingKey(f), layoutKey(f));
  });
});

describe('markPreExisting', () => {
  it('returns the findings untouched for an empty baseline and an empty list', () => {
    const fs = [find('min-text')];
    assert.deepEqual(markPreExisting(fs, []), fs);
    assert.deepEqual(markPreExisting([], [find('min-text')]), []);
  });

  it('caps only the finding with the same route, rule and selector', () => {
    const base = [find('min-text')];
    const now = [find('min-text'), find('min-text', { route: '/cockpit' }), find('min-text', { selector: 'p#other' }), find('grid')];
    const out = markPreExisting(now, base);
    assert.deepEqual(out.map((f) => [f.severity, f.preExisting === true]), [['medium', true], ['high', false], ['high', false], ['high', false]]);
  });

  it('does not match a baseline finding of another kind with the same title', () => {
    const f = find('min-text');
    const out = markPreExisting([f], [{ kind: 'console', title: f.title, route: '/', rule: 'min-text', selector: 'p#body13' }]);
    assert.equal(out[0].severity, 'high');
    assert.equal(out[0].preExisting, undefined);
  });

  it('never raises a low finding and leaves its inputs unchanged', () => {
    const low = { ...find('grid'), severity: 'low' };
    const input = [low];
    const frozen = JSON.stringify(input);
    const out = markPreExisting(input, [find('grid')]);
    assert.equal(out[0].severity, 'low');
    assert.equal(JSON.stringify(input), frozen);
  });

  it('caps a finding whose route is missing against a baseline whose route is missing', () => {
    const a = { kind: 'layout', rule: 'grid', selector: 'div', severity: 'high' };
    assert.equal(markPreExisting([a], [{ ...a }])[0].severity, 'medium');
  });

  it('keeps a medium pre-existing finding out of the blocking verdict', () => {
    const out = markPreExisting([find('min-text')], [find('min-text')]);
    assert.equal(verdict(out), 'success');
  });
});

describe('mergeFindings with layout findings', () => {
  it('lists one finding for the same element seen at two viewports, at the worse severity', () => {
    const merged = mergeFindings([find('min-text', { viewport: 'mobile' }), { ...find('min-text', { viewport: 'desktop' }), severity: 'medium' }]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].severity, 'high');
  });

  it('keeps two different elements apart', () => {
    assert.equal(mergeFindings([find('grid'), find('grid', { selector: 'div#b' })]).length, 2);
  });
});
