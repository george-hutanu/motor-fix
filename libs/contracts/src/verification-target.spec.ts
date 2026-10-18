import {
  approvalGaps,
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

describe('what an approval passes over', () => {
  // @traces 303-FR-003 303-FR-006
  const allOk = [
    'company',
    'caen',
    'rar',
    'activities',
    'representative',
    'address',
    'photos',
    'documents',
  ].map((kind) => ({ kind, result: 'ok' as const }));
  const both = ['onrc_certificate', 'rar_authorisation'];

  it('is nothing when every check is ok and both documents are there', () => {
    expect(approvalGaps(allOk, both)).toEqual([]);
  });

  it.each([
    'company',
    'activities',
    'representative',
    'address',
    'photos',
    'documents',
  ])('names the %s check for each result that is not ok', (kind) => {
    for (const result of ['not_run', 'warning', 'failed'] as const) {
      const checks = allOk.map((check) =>
        check.kind === kind ? { kind, result } : check,
      );
      expect(approvalGaps(checks, both)).toEqual([{ kind, result }]);
    }
  });

  it('leaves out the rar and caen checks, which the gates hold', () => {
    const checks = allOk.map((check) =>
      ['rar', 'caen'].includes(check.kind)
        ? { kind: check.kind, result: 'failed' as const }
        : check,
    );
    expect(approvalGaps(checks, both)).toEqual([]);
  });

  it('counts a check the file has no row for as not run', () => {
    expect(approvalGaps([], both)).toEqual(
      [
        'company',
        'activities',
        'representative',
        'address',
        'photos',
        'documents',
      ].map((kind) => ({ kind, result: 'not_run' })),
    );
  });

  it('names each missing document after the checks, in the kinds order', () => {
    const checks = allOk.map((check) =>
      check.kind === 'photos'
        ? { kind: 'photos', result: 'warning' as const }
        : check,
    );
    expect(approvalGaps(checks, [])).toEqual([
      { kind: 'photos', result: 'warning' },
      { document: 'onrc_certificate' },
      { document: 'rar_authorisation' },
    ]);
    expect(approvalGaps(allOk, ['rar_authorisation'])).toEqual([
      { document: 'onrc_certificate' },
    ]);
  });
});
