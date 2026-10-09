import {
  declarationDone,
  documentDone,
  isCalendarDate,
  isDocumentKind,
  issuedWithinWindow,
} from './legal-documents';
import { FILE_RULES } from '../files';
import { isListingDraftData } from '../listing-sections';

const key = (n: number) =>
  `legal_document/7c1f5d9e-2b44-4f0a-9a51-3d6e8c2b1f00/5e0a8f3b-91c2-4d7e-8b6a-0c4f2e9d1${String(n).padStart(3, '0')}`;
const pages = (n: number) => Array.from({ length: n }, (_, i) => key(i));

// @traces 206-FR-007
describe('the issue date window, attacked', () => {
  it('accepts exactly today and exactly 30 days back, refuses one day outside', () => {
    expect(issuedWithinWindow('2026-10-09', '2026-10-09')).toBe(true);
    expect(issuedWithinWindow('2026-09-09', '2026-10-09')).toBe(true);
    expect(issuedWithinWindow('2026-09-08', '2026-10-09')).toBe(false);
    expect(issuedWithinWindow('2026-10-10', '2026-10-09')).toBe(false);
  });

  it('counts across a leap day and a year boundary', () => {
    expect(issuedWithinWindow('2024-01-30', '2024-02-29')).toBe(true);
    expect(issuedWithinWindow('2024-01-29', '2024-02-29')).toBe(false);
    expect(issuedWithinWindow('2025-12-02', '2026-01-01')).toBe(true);
    expect(issuedWithinWindow('2025-12-01', '2026-01-01')).toBe(false);
  });

  it('counts across the clock changes in March and October', () => {
    expect(issuedWithinWindow('2026-02-27', '2026-03-29')).toBe(true);
    expect(issuedWithinWindow('2026-09-26', '2026-10-26')).toBe(true);
    expect(issuedWithinWindow('2026-09-25', '2026-10-26')).toBe(false);
  });

  it.each([
    '',
    '2026-02-30',
    '2026-13-01',
    '2026-00-10',
    '2026-10-00',
    '2026-1-9',
    '09-10-2026',
    ' 2026-10-09',
    '2026-10-09 ',
    '2026-10-09T00:00:00Z',
    '٢٠٢٦-١٠-٠٩',
    '2026/10/09',
  ])('refuses the malformed date %j on either side', (bad) => {
    expect(issuedWithinWindow(bad, '2026-10-09')).toBe(false);
    expect(issuedWithinWindow('2026-10-09', bad)).toBe(false);
    expect(isCalendarDate(bad)).toBe(false);
  });

  it('knows which February 29ths exist', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2023-02-29')).toBe(false);
    expect(isCalendarDate('1900-02-29')).toBe(false);
    expect(isCalendarDate('2000-02-29')).toBe(true);
  });

  it.each([null, undefined, 20261009, {}, [], ['2026-10-09']])(
    'refuses the non-string %j as a calendar date',
    (bad) => {
      expect(isCalendarDate(bad)).toBe(false);
    },
  );

  it('does not treat a far-past two-digit-century year as recent', () => {
    expect(issuedWithinWindow('0026-10-09', '2026-10-09')).toBe(false);
    expect(issuedWithinWindow('0099-10-09', '1999-10-09')).toBe(false);
  });
});

// @traces 206-FR-004
describe('the document kind guard, attacked', () => {
  it.each([
    'ONRC_CERTIFICATE',
    ' onrc_certificate',
    'onrc_certificate\n',
    'constructor',
    'toString',
    'hasOwnProperty',
    '',
    null,
    undefined,
    0,
    ['onrc_certificate'],
  ])('refuses %j', (bad) => {
    expect(isDocumentKind(bad)).toBe(false);
  });

  it('keeps the legal document purpose at ten pages of the three types', () => {
    expect(FILE_RULES.legal_document.maxBytes).toBe(10 * 1024 * 1024);
    expect([...FILE_RULES.legal_document.types].sort()).toEqual([
      'application/pdf',
      'image/jpeg',
      'image/png',
    ]);
  });
});

// @traces 206-FR-010
describe('the done states, attacked', () => {
  it('counts a document only with at least one page', () => {
    expect(documentDone(undefined, 'onrc_certificate')).toBe(false);
    expect(documentDone({}, 'onrc_certificate')).toBe(false);
    expect(
      documentDone(
        { documents: { onrc_certificate: { pages: [] } } },
        'onrc_certificate',
      ),
    ).toBe(false);
    expect(
      documentDone(
        { documents: { onrc_certificate: { pages: [key(1)] } } },
        'onrc_certificate',
      ),
    ).toBe(true);
  });

  it('does not count the other kind', () => {
    const data = { documents: { rar_authorisation: { pages: [key(1)] } } };
    expect(documentDone(data, 'onrc_certificate')).toBe(false);
    expect(documentDone(data, 'rar_authorisation')).toBe(true);
  });

  it('does not count a certificate without an issue date as missing', () => {
    expect(
      documentDone(
        { documents: { onrc_certificate: { pages: [key(1)] } } },
        'onrc_certificate',
      ),
    ).toBe(true);
  });

  it('needs the tick and a trimmed name of 2 to 80 characters', () => {
    const at = '2026-10-09T10:00:00.000Z';
    expect(declarationDone(undefined)).toBe(false);
    expect(declarationDone({})).toBe(false);
    expect(declarationDone({ declaredAt: at })).toBe(false);
    expect(declarationDone({ declaredByName: 'Ion Pop' })).toBe(false);
    expect(declarationDone({ declaredAt: '', declaredByName: 'Ion Pop' })).toBe(
      false,
    );
    expect(declarationDone({ declaredAt: at, declaredByName: 'I' })).toBe(
      false,
    );
    expect(declarationDone({ declaredAt: at, declaredByName: ' I ' })).toBe(
      false,
    );
    expect(declarationDone({ declaredAt: at, declaredByName: '   ' })).toBe(
      false,
    );
    expect(declarationDone({ declaredAt: at, declaredByName: 'Io' })).toBe(
      true,
    );
    expect(
      declarationDone({ declaredAt: at, declaredByName: 'a'.repeat(80) }),
    ).toBe(true);
    expect(
      declarationDone({ declaredAt: at, declaredByName: 'a'.repeat(81) }),
    ).toBe(false);
  });

  it('counts the trimmed length, not the padded one', () => {
    const at = '2026-10-09T10:00:00.000Z';
    expect(
      declarationDone({
        declaredAt: at,
        declaredByName: `  ${'a'.repeat(80)}  `,
      }),
    ).toBe(true);
  });

  it('counts a name of two letters outside ASCII', () => {
    const at = '2026-10-09T10:00:00.000Z';
    expect(declarationDone({ declaredAt: at, declaredByName: 'Șt' })).toBe(
      true,
    );
  });
});

// @traces 206-FR-006
describe('the draft envelope for documents, attacked', () => {
  const ok = (data: unknown) => isListingDraftData(data);

  it('accepts an empty documents map and a document of one to ten pages', () => {
    expect(ok({ documents: {} })).toBe(true);
    expect(ok({ documents: { rar_authorisation: { pages: pages(1) } } })).toBe(
      true,
    );
    expect(ok({ documents: { rar_authorisation: { pages: pages(10) } } })).toBe(
      true,
    );
  });

  it('refuses an eleventh page and a document with no page', () => {
    expect(ok({ documents: { rar_authorisation: { pages: pages(11) } } })).toBe(
      false,
    );
    expect(ok({ documents: { rar_authorisation: { pages: [] } } })).toBe(false);
  });

  it('refuses a repeated page key', () => {
    expect(
      ok({ documents: { rar_authorisation: { pages: [key(1), key(1)] } } }),
    ).toBe(false);
  });

  it.each([
    ['an unknown kind', { identity_card: { pages: pages(1) } }],
    ['a prototype kind', JSON.parse('{"__proto__":{"pages":[]}}')],
    ['a constructor kind', { constructor: { pages: pages(1) } }],
    ['an array for the map', [{ pages: pages(1) }]],
    ['null for the map', null],
    ['null for a document', { rar_authorisation: null }],
    ['a string for a document', { rar_authorisation: 'pages' }],
    ['an array for a document', { rar_authorisation: [] }],
    ['missing pages', { rar_authorisation: {} }],
    ['pages as a string', { rar_authorisation: { pages: key(1) } }],
    ['a non-string page', { rar_authorisation: { pages: [1] } }],
    ['a null page', { rar_authorisation: { pages: [null] } }],
    [
      'an extra key on a document',
      { rar_authorisation: { note: 'x', pages: pages(1) } },
    ],
    [
      'a page key with a path escape',
      { rar_authorisation: { pages: ['legal_document/../x/y'] } },
    ],
    [
      'a page key with a trailing newline',
      { rar_authorisation: { pages: [`${key(1)}\n`] } },
    ],
    [
      'a page key with an overlong last part',
      { rar_authorisation: { pages: [`${key(1)}${'a'.repeat(70)}`] } },
    ],
    [
      'an issue date on the authorisation',
      { rar_authorisation: { issuedOn: '2026-10-09', pages: pages(1) } },
    ],
    [
      'a malformed certificate date',
      { onrc_certificate: { issuedOn: '2026-02-30', pages: pages(1) } },
    ],
    [
      'a null certificate date',
      { onrc_certificate: { issuedOn: 5, pages: pages(1) } },
    ],
  ])('refuses %s', (_title, documents) => {
    expect(ok({ documents })).toBe(false);
  });

  it('accepts a certificate with a calendar date', () => {
    expect(
      ok({
        documents: {
          onrc_certificate: { issuedOn: '2026-10-09', pages: pages(2) },
        },
      }),
    ).toBe(true);
  });

  it('refuses documents next to other unknown keys and non-object drafts', () => {
    expect(ok({ documents: {}, extra: 1 })).toBe(false);
    expect(ok(null)).toBe(false);
    expect(ok([])).toBe(false);
    expect(ok('documents')).toBe(false);
  });

  it('refuses a declaration name or stamp of the wrong type or length', () => {
    expect(ok({ declaredByName: 5 })).toBe(false);
    expect(ok({ declaredByName: 'a'.repeat(81) })).toBe(false);
    expect(ok({ declaredAt: 5 })).toBe(false);
    expect(ok({ declaredAt: 'x'.repeat(41) })).toBe(false);
  });

  it('holds the trimmed name: padding counts against the 80 characters', () => {
    expect(ok({ declaredByName: ` ${'a'.repeat(78)} ` })).toBe(true);
    expect(ok({ declaredByName: `  ${'a'.repeat(80)}  ` })).toBe(false);
  });
});
