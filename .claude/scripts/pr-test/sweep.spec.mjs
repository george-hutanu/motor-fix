import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { VIEWPORTS, matrix, toFindings } from './sweep.mjs';

describe('the sweep matrix', () => {
  it('visits every route at four viewports, two schemes and two languages', () => {
    const runs = matrix({ routes: ['/', '/cockpit'] });
    assert.equal(runs.length, 2 * 4 * 2 * 2);
    assert.deepEqual([...new Set(runs.map((r) => r.viewport))], ['desktop', 'tablet', 'mobile', 'small-phone']);
    assert.deepEqual([...new Set(runs.map((r) => r.scheme))], ['light', 'dark']);
    assert.deepEqual([...new Set(runs.map((r) => r.lang))], ['ro', 'en']);
  });

  it('uses 1440×900 desktop, a tablet, a 390×844 and a 320×568 touch phone', () => {
    assert.deepEqual([VIEWPORTS.desktop.width, VIEWPORTS.desktop.height], [1440, 900]);
    assert.ok(VIEWPORTS.tablet.width >= 768 && VIEWPORTS.tablet.width < 1024);
    assert.deepEqual([VIEWPORTS.mobile.width, VIEWPORTS.mobile.height], [390, 844]);
    assert.equal(VIEWPORTS.mobile.isMobile, true);
    assert.equal(VIEWPORTS.mobile.hasTouch, true);
    // The specs ask for no horizontal scrolling down to 320 px, the narrowest
    // phone still in use; 390 alone lets a 320 px overflow through.
    assert.deepEqual([VIEWPORTS['small-phone'].width, VIEWPORTS['small-phone'].height], [320, 568]);
    assert.equal(VIEWPORTS['small-phone'].isMobile, true);
    assert.equal(VIEWPORTS['small-phone'].hasTouch, true);
  });

  it('names one screenshot per combination, readable and unique', () => {
    const runs = matrix({ routes: ['/', '/app/driver'] });
    const shots = runs.map((r) => r.shot);
    assert.equal(new Set(shots).size, shots.length);
    assert.ok(shots.includes('home-mobile-dark-en.png'));
    assert.ok(shots.includes('app-driver-desktop-light-ro.png'));
  });

  it('narrows to one language or scheme when asked', () => {
    assert.equal(matrix({ routes: ['/'], langs: ['ro'], schemes: ['light'] }).length, 4);
  });
});

describe('observations to findings', () => {
  const origins = ['http://127.0.0.1:4100', 'http://127.0.0.1:3100'];
  const at = (viewport, extra) => ({ route: '/', viewport, scheme: 'light', lang: 'ro', screenshot: `home-${viewport}-light-ro.png`, ...extra });

  it('folds the same problem seen in several combinations into one finding that lists where', () => {
    const obs = ['desktop', 'tablet', 'mobile'].map((v) => at(v, { kind: 'console', text: 'NG0100: changed after checked' }));
    const findings = toFindings(obs, { web: true, origins });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].seenIn.length, 3);
    assert.equal(findings[0].severity, 'high');
  });

  it('marks requests to other hosts as off-origin', () => {
    const findings = toFindings([at('desktop', { kind: 'request-failed', url: 'https://fonts.example.com/x.woff2', text: 'net::ERR_FAILED' })], { web: true, origins });
    assert.equal(findings[0].severity, 'low');
    const own = toFindings([at('desktop', { kind: 'request-failed', url: 'http://127.0.0.1:3100/api/x', text: 'net::ERR_FAILED' })], { web: true, origins });
    assert.equal(own[0].severity, 'high');
  });

  it('keeps the worst severity when the same problem ranks differently across viewports', () => {
    const obs = [at('desktop', { kind: 'overflow', scrollWidth: 1500, width: 1440 }), at('mobile', { kind: 'overflow', scrollWidth: 600, width: 390 })];
    const findings = toFindings(obs, { web: true, origins });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, 'high');
  });
});
