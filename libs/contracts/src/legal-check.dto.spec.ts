import { legalCheckRows } from './legal-check.dto';
import { recheckedSince } from './verification-target';

type LegalCheckSource = Parameters<typeof legalCheckRows>[0];

const check = (
  kind: 'company' | 'caen' | 'rar',
  result: 'ok' | 'warning' | 'failed' | 'not_run' = 'ok',
  detail: string | null = null,
  checkedOn: string | null = '2026-09-30',
) => ({ checkedOn, detail, kind, result });

const VALID = [
  { kind: 'onrc_certificate', status: 'valid' },
  { kind: 'rar_authorisation', status: 'valid' },
];

const source = (over: Partial<LegalCheckSource> = {}): LegalCheckSource => ({
  checks: [check('rar'), check('caen'), check('company')],
  documents: VALID,
  lastCheckedOn: '2026-10-01',
  ...over,
});

// @traces 210-FR-003
describe('the legal check rows', () => {
  it('are company, CAEN, RAR and documents, in that order', () => {
    expect(legalCheckRows(source()).map((row) => row.kind)).toEqual([
      'company',
      'caen',
      'rar',
      'documents',
    ]);
  });

  it('are all in order for a garage approved with every check ok', () => {
    expect(legalCheckRows(source())).toEqual([
      {
        checkedOn: '2026-09-30',
        detail: null,
        kind: 'company',
        missing: [],
        state: 'ok',
      },
      {
        checkedOn: '2026-09-30',
        detail: null,
        kind: 'caen',
        missing: [],
        state: 'ok',
      },
      {
        checkedOn: '2026-10-01',
        detail: null,
        kind: 'rar',
        missing: [],
        state: 'ok',
      },
      {
        checkedOn: '2026-10-01',
        detail: null,
        kind: 'documents',
        missing: [],
        state: 'ok',
      },
    ]);
  });
});

// @traces 210-FR-004
describe('a check row', () => {
  it.each(['ok', 'warning', 'failed', 'not_run'] as const)(
    'takes its state from a %s result',
    (result) => {
      const rows = legalCheckRows(
        source({
          checks: [
            check('company', result, 'x'),
            check('caen', result, 'x'),
            check('rar', result, 'x'),
          ],
        }),
      );
      expect(rows.slice(0, 3).map((row) => row.state)).toEqual([
        result,
        result,
        result,
      ]);
    },
  );

  it("shows the check's recorded detail only when it is not ok", () => {
    const rows = legalCheckRows(
      source({
        checks: [
          check('company', 'ok', 'CUI activ'),
          check('caen', 'warning', 'Cod CAEN secundar'),
          check('rar', 'failed', 'Autorizație expirată'),
        ],
      }),
    );
    expect(rows.slice(0, 3).map((row) => row.detail)).toEqual([
      null,
      'Cod CAEN secundar',
      'Autorizație expirată',
    ]);
  });

  it('is not run when the file has no such check', () => {
    const [company] = legalCheckRows(source({ checks: [] }));
    expect(company).toMatchObject({ checkedOn: null, state: 'not_run' });
  });
});

// @traces 1354-FR-003
describe('the RAR row day', () => {
  it("is the garage's stored date of last check, not the day the check was recorded", () => {
    const rar = legalCheckRows(source())[2];
    expect(rar?.checkedOn).toBe('2026-10-01');
  });

  it('stays the stored date after a valid re-check moved it', () => {
    const rar = legalCheckRows(
      source({
        lastCheckedOn: '2026-10-01',
        latestRecheck: {
          checkedOn: '2026-10-01',
          detail: null,
          failure: null,
          result: 'ok',
        },
      }),
    )[2];
    expect(rar).toMatchObject({ checkedOn: '2026-10-01', state: 'ok' });
  });

  it('is none while the check has not run', () => {
    const rar = legalCheckRows(
      source({ checks: [check('rar', 'not_run', null, null)] }),
    )[2];
    expect(rar?.checkedOn).toBeNull();
  });
});

const FAILED = {
  checkedOn: '2026-09-12',
  detail: 'Autorizația a expirat la 31 august',
  failure: 'expired' as const,
  result: 'failed' as const,
};

// @traces 1354-FR-004
describe('the RAR row of a garage suspended by a failed re-check', () => {
  it("is failed, on the re-check's day, with its recorded detail", () => {
    const rar = legalCheckRows(
      source({
        lastCheckedOn: '2026-08-10',
        latestRecheck: FAILED,
        recheckFailed: true,
      }),
    )[2];
    expect(rar).toEqual({
      checkedOn: '2026-09-12',
      detail: 'Autorizația a expirat la 31 august',
      failure: 'expired',
      kind: 'rar',
      missing: [],
      state: 'failed',
    });
  });

  it('is the ordinary row when the suspension has another cause', () => {
    const rar = legalCheckRows(
      source({
        lastCheckedOn: '2026-08-10',
        latestRecheck: FAILED,
        recheckFailed: false,
      }),
    )[2];
    expect(rar).toMatchObject({
      checkedOn: '2026-08-10',
      detail: null,
      state: 'ok',
    });
  });

  it('is the ordinary row when the latest re-check is ok', () => {
    const rar = legalCheckRows(
      source({
        latestRecheck: { ...FAILED, detail: null, failure: null, result: 'ok' },
        recheckFailed: true,
      }),
    )[2];
    expect(rar).toMatchObject({ checkedOn: '2026-10-01', state: 'ok' });
  });

  it('leaves the other three rows as they are', () => {
    const rows = legalCheckRows(
      source({ latestRecheck: FAILED, recheckFailed: true }),
    );
    expect(rows.filter((row) => row.kind !== 'rar')).toEqual(
      legalCheckRows(source()).filter((row) => row.kind !== 'rar'),
    );
  });
});

// @traces 1354-FR-003 1354-FR-005
describe('whether the stored date is a re-check', () => {
  const ok = (checkedOn: string) => ({ checkedOn, result: 'ok' as const });

  it('is not when the garage was never re-checked', () => {
    expect(recheckedSince(null, '2026-06-14')).toBe(false);
  });

  it('is not when the latest re-check failed', () => {
    expect(
      recheckedSince(
        { checkedOn: '2026-10-01', result: 'failed' },
        '2026-06-14',
      ),
    ).toBe(false);
  });

  it('is when the latest ok re-check is the stored day', () => {
    expect(recheckedSince(ok('2026-10-01'), '2026-10-01')).toBe(true);
  });

  it('is when the latest ok re-check is after the stored day', () => {
    expect(recheckedSince(ok('2026-10-02'), '2026-10-01')).toBe(true);
  });

  it('is not when the garage was approved again after the re-check', () => {
    expect(recheckedSince(ok('2026-09-01'), '2026-10-01')).toBe(false);
  });

  it('is not when no date is stored', () => {
    expect(recheckedSince(ok('2026-10-01'), null)).toBe(false);
  });
});

// @traces 210-FR-004
describe('the documents row', () => {
  it('is ok when both documents are valid, checked on the last check day', () => {
    expect(legalCheckRows(source())[3]).toEqual({
      checkedOn: '2026-10-01',
      detail: null,
      kind: 'documents',
      missing: [],
      state: 'ok',
    });
  });

  it('is a warning naming a document that is missing', () => {
    expect(legalCheckRows(source({ documents: [VALID[1]!] }))[3]).toMatchObject(
      { missing: ['onrc_certificate'], state: 'warning' },
    );
  });

  it('is a warning naming a document that is not valid', () => {
    expect(
      legalCheckRows(
        source({
          documents: [
            VALID[0]!,
            { kind: 'rar_authorisation', status: 'expired' },
          ],
        }),
      )[3],
    ).toMatchObject({ missing: ['rar_authorisation'], state: 'warning' });
  });

  it('names both when the file has none, in their own order', () => {
    expect(legalCheckRows(source({ documents: [] }))[3]).toMatchObject({
      missing: ['onrc_certificate', 'rar_authorisation'],
      state: 'warning',
    });
  });

  it('does not read the documents check', () => {
    expect(
      legalCheckRows(
        source({
          checks: [
            check('company'),
            check('caen'),
            check('rar'),
            {
              checkedOn: null,
              detail: 'x',
              kind: 'documents',
              result: 'failed',
            },
          ],
        }),
      )[3],
    ).toMatchObject({ state: 'ok' });
  });
});
