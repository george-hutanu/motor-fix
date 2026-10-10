import {
  CERTIFICATE_WINDOW_DAYS,
  DECLARED_NAME_MAX,
  DECLARED_NAME_MIN,
  DOCUMENT_KINDS,
  DOCUMENT_PAGES_MAX,
  declarationDone,
  documentDone,
  isDocumentKind,
  issuedWithinWindow,
} from './legal-documents';
import { FILE_RULES } from '../files';

const PAGE =
  'legal_document/7c1f5d9e-2b44-4f0a-9a51-3d6e8c2b1f00/5e0a8f3b-91c2-4d7e-8b6a-0c4f2e9d1a37';

// @traces 206-FR-004
describe('the document kinds', () => {
  it('are the trade register certificate and the RAR authorisation, in that order', () => {
    expect(DOCUMENT_KINDS).toEqual(['onrc_certificate', 'rar_authorisation']);
  });

  it('recognises only those kinds', () => {
    expect(isDocumentKind('onrc_certificate')).toBe(true);
    expect(isDocumentKind('rar_authorisation')).toBe(true);
    expect(isDocumentKind('identity_card')).toBe(false);
    expect(isDocumentKind('__proto__')).toBe(false);
  });

  it('hold at most 10 pages of PDF, JPEG or PNG up to 10 MB', () => {
    expect(DOCUMENT_PAGES_MAX).toBe(10);
    expect(FILE_RULES.legal_document).toEqual({
      maxBytes: 10 * 1024 * 1024,
      types: ['application/pdf', 'image/jpeg', 'image/png'],
    });
  });
});

// @traces 206-FR-007
describe('the certificate issue-date window', () => {
  const today = '2026-10-09';

  it('is 30 days', () => {
    expect(CERTIFICATE_WINDOW_DAYS).toBe(30);
  });

  it.each([
    ['today', '2026-10-09'],
    ['30 days ago', '2026-09-09'],
  ])('accepts %s', (_, issuedOn) => {
    expect(issuedWithinWindow(issuedOn, today)).toBe(true);
  });

  it.each([
    ['31 days ago', '2026-09-08'],
    ['tomorrow', '2026-10-10'],
    ['a malformed date', '09.10.2026'],
    ['an impossible date', '2026-02-30'],
  ])('refuses %s', (_, issuedOn) => {
    expect(issuedWithinWindow(issuedOn, today)).toBe(false);
  });

  it('counts calendar days across a month and a year end', () => {
    expect(issuedWithinWindow('2025-12-02', '2026-01-01')).toBe(true);
    expect(issuedWithinWindow('2025-12-01', '2026-01-01')).toBe(false);
  });
});

// @traces 206-FR-006
describe('a document done', () => {
  it('needs at least one confirmed page', () => {
    expect(
      documentDone(
        { documents: { onrc_certificate: { pages: [PAGE] } } },
        'onrc_certificate',
      ),
    ).toBe(true);
  });

  it.each([
    ['no data', undefined],
    ['no documents', {}],
    [
      'the other kind only',
      { documents: { rar_authorisation: { pages: [PAGE] } } },
    ],
    ['no pages', { documents: { onrc_certificate: { pages: [] } } }],
  ])('is not met with %s', (_, data) => {
    expect(documentDone(data, 'onrc_certificate')).toBe(false);
  });
});

// @traces 206-FR-009
describe('the declaration done', () => {
  const at = '2026-10-09T10:00:00.000Z';

  it('needs the server time and a name of 2 to 80 trimmed characters', () => {
    expect(DECLARED_NAME_MIN).toBe(2);
    expect(DECLARED_NAME_MAX).toBe(80);
    expect(
      declarationDone({ declaredAt: at, declaredByName: 'Ion Popescu' }),
    ).toBe(true);
    expect(declarationDone({ declaredAt: at, declaredByName: ' Io ' })).toBe(
      true,
    );
    expect(
      declarationDone({ declaredAt: at, declaredByName: 'a'.repeat(80) }),
    ).toBe(true);
  });

  it.each([
    ['no tick', { declaredByName: 'Ion Popescu' }],
    ['no name', { declaredAt: at }],
    ['a one-letter name', { declaredAt: at, declaredByName: ' I ' }],
    ['a blank name', { declaredAt: at, declaredByName: '    ' }],
    ['a name over 80', { declaredAt: at, declaredByName: 'a'.repeat(81) }],
    ['no data', undefined],
  ])('is not met with %s', (_, data) => {
    expect(declarationDone(data)).toBe(false);
  });
});
