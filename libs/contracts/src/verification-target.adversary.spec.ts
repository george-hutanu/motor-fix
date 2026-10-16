import type { VerificationCheckResult } from './verification-checks';
import {
  queueLamp,
  VERIFICATION_QUEUE_PAGE,
  VERIFICATION_QUEUE_PANEL,
  VERIFICATION_TARGET_WORKING_DAYS,
} from './verification-target';

// @traces 301-FR-002
const checks = (...results: VerificationCheckResult[]) =>
  results.map((result) => ({ result }));

describe('the queue constants', () => {
  it('hold the numbers the spec names', () => {
    expect(VERIFICATION_TARGET_WORKING_DAYS).toBe(2);
    expect(VERIFICATION_QUEUE_PAGE).toBe(20);
    expect(VERIFICATION_QUEUE_PANEL).toBe(5);
  });
});

describe('the queue lamp', () => {
  it('is grey with no checks and not flagged', () => {
    expect(queueLamp([], false)).toBe('grey');
  });

  it('is amber with no checks and flagged', () => {
    expect(queueLamp([], true)).toBe('amber');
  });

  it('is grey when every check is not run', () => {
    expect(queueLamp(checks('not_run', 'not_run'), false)).toBe('grey');
  });

  it('is amber when every check is not run and flagged', () => {
    expect(queueLamp(checks('not_run'), true)).toBe('amber');
  });

  it('is green when one check is ok and the rest are not run', () => {
    expect(queueLamp(checks('ok', 'not_run', 'not_run'), false)).toBe('green');
  });

  it('is amber when a warning sits beside ok checks', () => {
    expect(queueLamp(checks('ok', 'warning', 'ok'), false)).toBe('amber');
  });

  it('is amber when flagged even if every check is ok', () => {
    expect(queueLamp(checks('ok', 'ok'), true)).toBe('amber');
  });

  it('is red when a check failed and the file is not flagged', () => {
    expect(queueLamp(checks('ok', 'failed'), false)).toBe('red');
  });

  it('is red when a check failed and the file is flagged', () => {
    expect(queueLamp(checks('failed', 'warning'), true)).toBe('red');
  });

  it('is red for a single failed check among eight', () => {
    const eight = checks(
      'ok',
      'ok',
      'warning',
      'not_run',
      'ok',
      'ok',
      'failed',
      'ok',
    );
    expect(queueLamp(eight, true)).toBe('red');
    expect(queueLamp(eight, false)).toBe('red');
  });

  it('does not depend on the order of the checks', () => {
    const forward = checks('ok', 'warning', 'failed');
    expect(queueLamp([...forward].reverse(), false)).toBe(
      queueLamp(forward, false),
    );
  });

  it('does not change the checks it is given', () => {
    const input = checks('ok', 'failed');
    queueLamp(input, true);
    expect(input).toEqual([{ result: 'ok' }, { result: 'failed' }]);
  });

  it('answers green for ten thousand ok checks', () => {
    const many = checks(...Array<VerificationCheckResult>(10_000).fill('ok'));
    expect(queueLamp(many, false)).toBe('green');
  });
});
