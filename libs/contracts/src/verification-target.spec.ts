import {
  queueLamp,
  VERIFICATION_QUEUE_PAGE,
  VERIFICATION_QUEUE_PANEL,
  VERIFICATION_TARGET_WORKING_DAYS,
} from './verification-target';

// @traces 301-FR-002 301-FR-004

const results = (...list: ('not_run' | 'ok' | 'warning' | 'failed')[]) =>
  list.map((result) => ({ result }));

describe("a queue row's lamp", () => {
  it('is red when a check failed, flagged or not', () => {
    expect(queueLamp(results('ok', 'failed', 'warning'), false)).toBe('red');
    expect(queueLamp(results('failed'), true)).toBe('red');
  });

  it('is amber when the file is flagged and nothing failed', () => {
    expect(queueLamp(results('ok', 'ok'), true)).toBe('amber');
    expect(queueLamp(results('not_run'), true)).toBe('amber');
  });

  it('is amber when a check is a warning', () => {
    expect(queueLamp(results('ok', 'warning'), false)).toBe('amber');
  });

  it('is green when a check is ok and none is a warning or failed', () => {
    expect(queueLamp(results('ok', 'not_run'), false)).toBe('green');
  });

  it('is grey when nothing is recorded', () => {
    expect(queueLamp(results('not_run', 'not_run'), false)).toBe('grey');
    expect(queueLamp([], false)).toBe('grey');
  });
});

describe('the queue constants', () => {
  it('flag after 2 working days and page by 20, 5 on the panel', () => {
    expect(VERIFICATION_TARGET_WORKING_DAYS).toBe(2);
    expect(VERIFICATION_QUEUE_PAGE).toBe(20);
    expect(VERIFICATION_QUEUE_PANEL).toBe(5);
  });
});
