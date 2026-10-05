import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import {
  appsFor,
  cutOffFinding,
  endpointFinding,
  readinessOutcome,
  reportMarkdown,
  sweepFinding,
  testFinding,
  touchesWeb,
  verdict,
} from './findings.mjs';

const where = { route: '/', viewport: 'mobile', scheme: 'dark', lang: 'en', screenshot: 'shots/home-mobile-dark-en.png' };
const severityOf = (obs, web = true) => sweepFinding({ ...where, ...obs }, { web }).severity;

describe('severity of what the sweep saw', () => {
  it('ranks a page that breaks as a blocker', () => {
    assert.equal(severityOf({ kind: 'pageerror', text: 'TypeError: x is undefined' }), 'blocker');
    assert.equal(severityOf({ kind: 'load', text: 'net::ERR_CONNECTION_REFUSED' }), 'blocker');
  });

  it('ranks console errors, failed requests and server errors as high', () => {
    assert.equal(severityOf({ kind: 'console', text: 'NG0100' }), 'high');
    assert.equal(severityOf({ kind: 'request-failed', url: '/api/x', text: 'net::ERR_FAILED' }), 'high');
    assert.equal(severityOf({ kind: 'http', url: '/api/x', status: 502 }), 'high');
  });

  it('ranks a failed request to another host as low: the verdict is about the change, not the network', () => {
    assert.equal(severityOf({ kind: 'request-failed', url: 'https://fonts.example.com/a.woff2', text: 'net::ERR_FAILED', offOrigin: true }), 'low');
    assert.equal(severityOf({ kind: 'http', url: 'https://cdn.example.com/x', status: 503, offOrigin: true }), 'low');
  });

  it('ranks client errors as medium', () => {
    assert.equal(severityOf({ kind: 'http', url: '/missing.png', status: 404 }), 'medium');
  });

  it('ranks axe violations by their impact', () => {
    assert.equal(severityOf({ kind: 'axe', impact: 'critical', rule: 'button-name' }), 'high');
    assert.equal(severityOf({ kind: 'axe', impact: 'serious', rule: 'color-contrast' }), 'high');
    assert.equal(severityOf({ kind: 'axe', impact: 'moderate', rule: 'region' }), 'medium');
    assert.equal(severityOf({ kind: 'axe', impact: 'minor', rule: 'x' }), 'low');
  });

  it('ranks horizontal overflow high on mobile and medium elsewhere', () => {
    assert.equal(severityOf({ kind: 'overflow', scrollWidth: 520, width: 390 }), 'high');
    assert.equal(sweepFinding({ ...where, viewport: 'desktop', kind: 'overflow', scrollWidth: 1500, width: 1440 }, { web: true }).severity, 'medium');
  });

  it('caps what a change without web code did not cause at medium, and says it is pre-existing', () => {
    const f = sweepFinding({ ...where, kind: 'pageerror', text: 'boom' }, { web: false });
    assert.equal(f.severity, 'medium');
    assert.equal(f.preExisting, true);
    assert.equal(severityOf({ kind: 'axe', impact: 'minor', rule: 'x' }, false), 'low');
  });

  it('keeps a page that does not load a blocker even when no web code changed', () => {
    assert.equal(severityOf({ kind: 'load', text: 'timeout' }, false), 'blocker');
  });

  it('carries where it happened, how to reproduce it and the screenshot', () => {
    const f = sweepFinding({ ...where, kind: 'console', text: 'NG0100' }, { web: true });
    assert.equal(f.route, '/');
    assert.equal(f.viewport, 'mobile');
    assert.equal(f.scheme, 'dark');
    assert.equal(f.lang, 'en');
    assert.equal(f.evidence, 'shots/home-mobile-dark-en.png');
    assert.ok(f.steps.length >= 2);
    assert.match(f.steps.join(' '), /390|mobile/);
    assert.match(f.title, /NG0100/);
  });
});

describe('API calls and tests', () => {
  it('makes a server error on an endpoint high and anything else no finding', () => {
    assert.equal(endpointFinding({ method: 'GET', path: '/health/ready', status: 503, body: '{}' }).severity, 'high');
    assert.equal(endpointFinding({ method: 'GET', path: '/garages', status: 200 }), null);
    assert.equal(endpointFinding({ method: 'GET', path: '/garages', status: 401 }), null);
  });

  it('makes a failing test run a blocker', () => {
    const f = testFinding({ name: 'affected unit tests', command: 'npx nx affected -t test', code: 1, tail: '1 failed' });
    assert.equal(f.severity, 'blocker');
    assert.match(f.steps.join(' '), /nx affected/);
    assert.equal(testFinding({ name: 'e2e', command: 'npx playwright test', code: 0, tail: '' }), null);
  });
});

describe('the verdict', () => {
  it('fails on any blocker or high finding and succeeds otherwise', () => {
    assert.equal(verdict([]), 'success');
    assert.equal(verdict([{ severity: 'medium' }, { severity: 'low' }]), 'success');
    assert.equal(verdict([{ severity: 'low' }, { severity: 'high' }]), 'failure');
    assert.equal(verdict([{ severity: 'blocker' }]), 'failure');
  });
});

describe('what the diff asks for', () => {
  it('knows when a change touches web code', () => {
    assert.equal(touchesWeb(['apps/web/src/app/app.ts']), true);
    assert.equal(touchesWeb(['libs/ui-cockpit/src/styles/cockpit.css']), true);
    assert.equal(touchesWeb(['libs/i18n/src/shell/en.json']), true);
    assert.equal(touchesWeb(['.claude/hooks/merge-gate.mjs', 'AGENTS.md', 'apps/api/src/main.ts']), false);
  });

  it('boots the api and web always, and the worker only for worker or shared server code', () => {
    assert.deepEqual(appsFor(['AGENTS.md']), { api: true, web: true, worker: false });
    assert.deepEqual(appsFor(['apps/worker/src/main.ts']), { api: true, web: true, worker: true });
    assert.deepEqual(appsFor(['libs/domain/src/health/health.service.ts']), { api: true, web: true, worker: true });
  });
});

describe('readiness', () => {
  const body = (checks) => JSON.stringify({ status: 'error', checks });

  it('is a note, not a finding, when storage alone is down and no object store was started', () => {
    const out = readinessOutcome({ name: 'api', status: 503, body: body({ postgres: 'ok', redis: 'ok', storage: 'down' }), storage: false, url: 'http://x/health/ready' });
    assert.equal(out.finding, undefined);
    assert.match(out.note, /api/);
    assert.match(out.note, /storage/i);
    assert.match(out.note, /no object store/i);
  });

  it('blocks when storage is down although an object store was started', () => {
    const out = readinessOutcome({ name: 'api', status: 503, body: body({ postgres: 'ok', redis: 'ok', storage: 'down' }), storage: true, url: 'http://x/health/ready' });
    assert.equal(out.note, undefined);
    assert.equal(out.finding.severity, 'blocker');
    assert.match(out.finding.title, /storage/);
  });

  it('blocks when another check failed, with or without an object store', () => {
    const out = readinessOutcome({ name: 'worker', status: 503, body: body({ postgres: 'down', redis: 'ok', storage: 'down' }), storage: false, url: 'http://x/health/ready' });
    assert.equal(out.finding.severity, 'blocker');
    assert.match(out.finding.title, /postgres, storage/);
  });

  it('blocks on an answer that is not JSON, naming the status', () => {
    const out = readinessOutcome({ name: 'api', status: 502, body: 'Bad gateway', storage: false, url: 'http://x/health/ready' });
    assert.equal(out.finding.severity, 'blocker');
    assert.match(out.finding.title, /502/);
  });

  it('says nothing on 200', () => {
    assert.deepEqual(readinessOutcome({ name: 'api', status: 200, body: body({}), storage: false, url: 'u' }), {});
  });
});

describe('a lap cut off', () => {
  it('is a blocker naming the signal and the phase it was in', () => {
    const f = cutOffFinding('SIGTERM', 'sweep');
    assert.equal(f.severity, 'blocker');
    assert.match(f.title, /SIGTERM/);
    assert.match(f.title, /sweep/);
    assert.equal(verdict([f]), 'failure');
  });
});

describe('the report', () => {
  it('leads with the verdict and lists each finding with severity, place, steps and evidence', () => {
    const findings = [sweepFinding({ ...where, kind: 'console', text: 'NG0100' }, { web: true })];
    const md = reportMarkdown({ pr: 14, sha: 'abcdef1234567', verdict: 'failure', findings, booted: ['api', 'web'], screenshots: [] });
    assert.match(md.split('\n')[0], /failure/i);
    assert.match(md, /abcdef1/);
    assert.match(md, /high/);
    assert.match(md, /NG0100/);
    assert.match(md, /shots\/home-mobile-dark-en\.png/);
  });

  it('says so when there is nothing to report', () => {
    const md = reportMarkdown({ pr: 1, sha: 'abcdef1', verdict: 'success', findings: [], booted: ['api', 'web'], screenshots: [] });
    assert.match(md, /success/i);
    assert.match(md, /no findings/i);
  });
});
