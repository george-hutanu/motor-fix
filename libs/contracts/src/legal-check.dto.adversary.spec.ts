import { legalCheckRows } from './legal-check.dto';

const chk = (
  kind: string,
  result: 'ok' | 'warning' | 'failed' | 'not_run',
  detail: string | null = null,
  checkedOn: string | null = '2026-09-01',
) => ({ checkedOn, detail, kind, result });
const doc = (kind: string, status: string) => ({ kind, status });
const bothValid = [
  doc('onrc_certificate', 'valid'),
  doc('rar_authorisation', 'valid'),
];

// @traces 210-FR-003
describe('legalCheckRows adversary', () => {
  it('returns four rows in order for empty input', () => {
    const rows = legalCheckRows({
      checks: [],
      documents: [],
      lastCheckedOn: null,
    });

    expect(rows.map((r) => r.kind)).toEqual([
      'company',
      'caen',
      'rar',
      'documents',
    ]);
    expect(rows.slice(0, 3).map((r) => r.state)).toEqual([
      'not_run',
      'not_run',
      'not_run',
    ]);
  });

  it('keeps the order whatever order the checks arrive in', () => {
    const rows = legalCheckRows({
      checks: [
        chk('rar', 'ok'),
        chk('caen', 'failed', 'x'),
        chk('company', 'ok'),
      ],
      documents: bothValid,
      lastCheckedOn: '2026-10-01',
    });

    expect(rows.map((r) => [r.kind, r.state])).toEqual([
      ['company', 'ok'],
      ['caen', 'failed'],
      ['rar', 'ok'],
      ['documents', 'ok'],
    ]);
  });

  it.each(['ok', 'warning', 'failed', 'not_run'] as const)(
    'maps a %s check to the same state',
    (result) => {
      const rows = legalCheckRows({
        checks: [chk('company', result, 'why')],
        documents: bothValid,
        lastCheckedOn: null,
      });

      expect(rows[0].state).toBe(result);
    },
  );

  it('ignores the documents check and unknown check kinds', () => {
    const rows = legalCheckRows({
      checks: [chk('documents', 'failed', 'bad'), chk('bogus', 'failed')],
      documents: [],
      lastCheckedOn: '2026-10-01',
    });

    expect(rows[3].state).toBe('warning');
    expect(rows[3].detail).toBeNull();
    expect(rows.slice(0, 3).map((r) => r.state)).toEqual([
      'not_run',
      'not_run',
      'not_run',
    ]);
  });

  // @traces 210-FR-004
  it('is ok on the documents row only with both documents valid', () => {
    const rows = legalCheckRows({
      checks: [],
      documents: bothValid,
      lastCheckedOn: '2026-10-01',
    });

    expect(rows[3]).toEqual({
      checkedOn: '2026-10-01',
      detail: null,
      kind: 'documents',
      missing: [],
      state: 'ok',
    });
  });

  // @traces 210-FR-004
  it.each([
    ['pending', 'rar_authorisation'],
    ['rejected', 'rar_authorisation'],
    ['expired', 'rar_authorisation'],
    ['VALID', 'rar_authorisation'],
    ['', 'rar_authorisation'],
  ])('lists a %s document as missing', (status) => {
    const rows = legalCheckRows({
      checks: [],
      documents: [
        doc('onrc_certificate', 'valid'),
        doc('rar_authorisation', status),
      ],
      lastCheckedOn: null,
    });

    expect(rows[3].state).toBe('warning');
    expect(rows[3].missing).toEqual(['rar_authorisation']);
  });

  // @traces 210-FR-004
  it('lists both kinds when no document exists', () => {
    const rows = legalCheckRows({
      checks: [],
      documents: [],
      lastCheckedOn: null,
    });

    expect(rows[3].missing).toEqual(['onrc_certificate', 'rar_authorisation']);
  });

  // @traces 210-FR-004
  it('is not fooled by two valid documents of the same kind', () => {
    const rows = legalCheckRows({
      checks: [],
      documents: [
        doc('onrc_certificate', 'valid'),
        doc('onrc_certificate', 'valid'),
      ],
      lastCheckedOn: null,
    });

    expect(rows[3].missing).toEqual(['rar_authorisation']);
  });

  // @traces 210-FR-004
  it('is ok when one of two documents of a kind is valid', () => {
    const rows = legalCheckRows({
      checks: [],
      documents: [
        doc('onrc_certificate', 'rejected'),
        doc('onrc_certificate', 'valid'),
        doc('rar_authorisation', 'valid'),
      ],
      lastCheckedOn: null,
    });

    expect(rows[3].state).toBe('ok');
  });

  // @traces 210-FR-003
  it('gives null checkedOn for not_run even when a day is recorded', () => {
    const rows = legalCheckRows({
      checks: [chk('rar', 'not_run', null, '2026-09-01')],
      documents: bothValid,
      lastCheckedOn: '2026-10-01',
    });

    expect(rows[2].checkedOn).toBeNull();
  });

  // @traces 210-FR-009
  it('falls back to lastCheckedOn when the check has no day', () => {
    const rows = legalCheckRows({
      checks: [chk('rar', 'ok', null, null)],
      documents: bothValid,
      lastCheckedOn: '2026-10-01',
    });

    expect(rows[2].checkedOn).toBe('2026-10-01');
  });

  // @traces 1354-FR-003
  it('takes lastCheckedOn over the check day for the RAR row', () => {
    const rows = legalCheckRows({
      checks: [chk('rar', 'ok', null, '2026-09-01')],
      documents: bothValid,
      lastCheckedOn: '2026-10-01',
    });

    expect(rows[2].checkedOn).toBe('2026-10-01');
  });

  // @traces 210-FR-009
  it('gives null checkedOn on a ran check when both days are null', () => {
    const rows = legalCheckRows({
      checks: [chk('rar', 'warning', 'd', null)],
      documents: bothValid,
      lastCheckedOn: null,
    });

    expect(rows[2].checkedOn).toBeNull();
  });

  // @traces 210-FR-003
  it('drops the detail when the check is ok', () => {
    const rows = legalCheckRows({
      checks: [chk('caen', 'ok', 'stale text')],
      documents: bothValid,
      lastCheckedOn: null,
    });

    expect(rows[1].detail).toBeNull();
  });

  // @traces 210-FR-003
  it.each(['warning', 'failed', 'not_run'] as const)(
    'keeps the recorded detail on a %s check',
    (result) => {
      const rows = legalCheckRows({
        checks: [chk('caen', result, 'CAEN 4520 missing')],
        documents: bothValid,
        lastCheckedOn: null,
      });

      expect(rows[1].detail).toBe('CAEN 4520 missing');
    },
  );

  // @traces 210-FR-003
  it('uses the first check when a kind appears twice', () => {
    const rows = legalCheckRows({
      checks: [chk('company', 'failed', 'first'), chk('company', 'ok')],
      documents: bothValid,
      lastCheckedOn: null,
    });

    expect(rows[0].state).toBe('failed');
  });

  // @traces 210-FR-003
  it('returns the same result when called twice and does not mutate input', () => {
    const source = {
      checks: [chk('company', 'ok')],
      documents: [doc('onrc_certificate', 'valid')],
      lastCheckedOn: '2026-10-01',
    };
    const snapshot = JSON.stringify(source);

    expect(legalCheckRows(source)).toEqual(legalCheckRows(source));
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  // @traces 210-FR-003
  it('gives check rows an empty missing list', () => {
    const rows = legalCheckRows({
      checks: [],
      documents: [],
      lastCheckedOn: null,
    });

    expect(rows.slice(0, 3).map((r) => r.missing)).toEqual([[], [], []]);
  });

  // @traces 210-FR-003
  it('handles ten thousand checks', () => {
    const checks = Array.from({ length: 10000 }, () => chk('bogus', 'ok'));
    checks.push(chk('rar', 'failed', 'late'));
    const rows = legalCheckRows({
      checks,
      documents: bothValid,
      lastCheckedOn: null,
    });

    expect(rows[2].state).toBe('failed');
  });
});
