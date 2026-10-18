import { type LegalCheckSource, legalCheckRows } from './legal-check.dto';

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
        checkedOn: '2026-09-30',
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

// @traces 210-FR-009
describe('the RAR row day', () => {
  it('is the day the check was recorded', () => {
    const rar = legalCheckRows(source())[2];
    expect(rar?.checkedOn).toBe('2026-09-30');
  });

  it('falls back to the last check day when the check holds no day', () => {
    const rar = legalCheckRows(
      source({ checks: [check('rar', 'ok', null, null)] }),
    )[2];
    expect(rar?.checkedOn).toBe('2026-10-01');
  });

  it('is none while the check has not run', () => {
    const rar = legalCheckRows(
      source({ checks: [check('rar', 'not_run', null, null)] }),
    )[2];
    expect(rar?.checkedOn).toBeNull();
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
