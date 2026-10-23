import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { DocumentsSubmitDto } from './document-cycle.dto';
import { DocumentUploadRequestDto } from './legal-documents.dto';

// As the API's ValidationPipe checks a body: unknown fields refused.
function failed<T extends object>(type: new () => T, body: object): string[] {
  const errors = validateSync(plainToInstance(type, body), {
    forbidNonWhitelisted: true,
    whitelist: true,
  });
  const paths = (list: typeof errors, prefix: string): string[] =>
    list.flatMap((error) => {
      const path = `${prefix}${error.property}`;
      return error.children?.length
        ? paths(error.children, `${path}.`)
        : [path];
    });
  return paths(errors, '');
}

const key = (n: number) =>
  `incoming/legal_document/7c1f5d9e-2b44-4f0a-9a51-3d6e8c2b1f00/5e0a8f3b-91c2-4d7e-8b6a-0c4f2e9d1${String(n).padStart(3, '0')}`;
const pages = (n: number) => Array.from({ length: n }, (_, i) => key(i));

const certificate = {
  issuedOn: '2026-10-20',
  kind: 'onrc_certificate',
  pages: pages(1),
};
const authorisation = {
  issuedOn: '2025-03-01',
  kind: 'rar_authorisation',
  pages: pages(2),
};

// @traces 068-FR-006
// @traces 068-FR-015
describe('asking for a yearly document upload address', () => {
  it('takes a PDF size and checksum', () => {
    expect(
      failed(DocumentUploadRequestDto, {
        checksum: 'yPQ5Jg==',
        contentType: 'application/pdf',
        size: 1024,
      }),
    ).toEqual([]);
  });

  it('refuses a missing size and an unknown field', () => {
    expect(
      failed(DocumentUploadRequestDto, {
        checksum: 'yPQ5Jg==',
        contentType: 'application/pdf',
        kind: 'onrc_certificate',
      }),
    ).toEqual(['kind', 'size']);
  });
});

// @traces 068-FR-007
// @traces 068-FR-015
describe('the yearly documents upload body', () => {
  it('takes both kinds, each with pages and an issue date', () => {
    expect(
      failed(DocumentsSubmitDto, { documents: [certificate, authorisation] }),
    ).toEqual([]);
  });

  it('takes one kind alone; the service decides whether the other may wait', () => {
    expect(failed(DocumentsSubmitDto, { documents: [authorisation] })).toEqual(
      [],
    );
  });

  it('takes 10 pages and refuses 11 or none', () => {
    const with_ = (n: number) => ({
      documents: [{ ...certificate, pages: pages(n) }],
    });
    expect(failed(DocumentsSubmitDto, with_(10))).toEqual([]);
    expect(failed(DocumentsSubmitDto, with_(11))).toEqual([
      'documents.0.pages',
    ]);
    expect(failed(DocumentsSubmitDto, with_(0))).toEqual(['documents.0.pages']);
  });

  it('refuses the same page twice in a document', () => {
    expect(
      failed(DocumentsSubmitDto, {
        documents: [{ ...certificate, pages: [key(1), key(1)] }],
      }),
    ).toEqual(['documents.0.pages']);
  });

  it('refuses no document, three, and the same kind twice', () => {
    expect(failed(DocumentsSubmitDto, { documents: [] })).toEqual([
      'documents',
    ]);
    expect(
      failed(DocumentsSubmitDto, {
        documents: [certificate, authorisation, certificate],
      }),
    ).toContain('documents');
    expect(
      failed(DocumentsSubmitDto, { documents: [certificate, certificate] }),
    ).toEqual(['documents']);
    expect(failed(DocumentsSubmitDto, {})).toEqual(['documents']);
  });

  it.each(['identity_card', 'ONRC_CERTIFICATE', '__proto__'])(
    'refuses the kind %s',
    (kind) => {
      expect(
        failed(DocumentsSubmitDto, { documents: [{ ...certificate, kind }] }),
      ).toEqual(['documents.0.kind']);
    },
  );

  it.each([undefined, '', '2026-02-30', '20-10-2026', '2026-10-20T00:00:00Z'])(
    'refuses the issue date %j',
    (issuedOn) => {
      expect(
        failed(DocumentsSubmitDto, {
          documents: [{ ...authorisation, issuedOn }],
        }),
      ).toEqual(['documents.0.issuedOn']);
    },
  );

  it('refuses a page that is not text, and an unknown field', () => {
    expect(
      failed(DocumentsSubmitDto, {
        documents: [{ ...certificate, pages: [7] }],
      }),
    ).toEqual(['documents.0.pages']);
    expect(
      failed(DocumentsSubmitDto, {
        documents: [{ ...certificate, status: 'valid' }],
      }),
    ).toEqual(['documents.0.status']);
  });
});
