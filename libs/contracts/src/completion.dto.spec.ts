import 'reflect-metadata';

import { instanceToPlain, plainToInstance } from 'class-transformer';

import { DOCUMENT_KINDS } from './legal-documents/legal-documents';
import { CompletionCopyDto, HeldDocumentDto } from './listing-drafts.dto';
import { VerificationStatusDto } from './verification-status.dto';

type Documented = {
  enum?: readonly string[];
  format?: string;
  isArray?: boolean;
  nullable?: boolean;
  required?: boolean;
  type?: unknown;
};

const documented = (dto: object, name: string) =>
  Reflect.getMetadata('swagger/apiModelProperties', dto, name) as
    | Documented
    | undefined;

// Swagger keeps `type: [X]` either as written or as `type: X, isArray`.
const itemsOf = (meta: Documented | undefined) =>
  meta?.isArray ? meta.type : Array.isArray(meta?.type) ? meta.type[0] : null;

const listed = (dto: object) =>
  (
    (Reflect.getMetadata('swagger/apiModelPropertiesArray', dto) ??
      []) as string[]
  ).map((name) => name.replace(/^:/, ''));

// @traces 208-FR-004 208-FR-012
describe('the completion copy in the contract', () => {
  it('is a listing draft with its key, the items asked for, whether it was edited and the documents on file', () => {
    const names = listed(CompletionCopyDto.prototype);

    for (const name of ['id', 'data', 'step', 'language', 'status'])
      expect(names).toContain(name);
    const token = documented(CompletionCopyDto.prototype, 'token');
    expect(token).toBeDefined();
    expect(token?.required).not.toBe(false);
    expect(
      itemsOf(documented(CompletionCopyDto.prototype, 'requestedItems')),
    ).toBe(String);
    expect(documented(CompletionCopyDto.prototype, 'edited')).toBeDefined();
    expect(itemsOf(documented(CompletionCopyDto.prototype, 'held'))).toBe(
      HeldDocumentDto,
    );
  });

  it('describes a document on file by its kind, its pages and its issue day', () => {
    expect(documented(HeldDocumentDto.prototype, 'kind')?.enum).toEqual(
      DOCUMENT_KINDS,
    );
    expect(documented(HeldDocumentDto.prototype, 'pages')).toMatchObject({
      type: 'integer',
    });
    expect(documented(HeldDocumentDto.prototype, 'issuedOn')).toMatchObject({
      format: 'date',
      nullable: true,
    });
  });

  it('serializes every field the form adopts', () => {
    const copy = plainToInstance(CompletionCopyDto, {
      data: { steps: {} },
      edited: false,
      email: 'radu@example.ro',
      held: [
        { issuedOn: '2026-09-30', kind: 'onrc_certificate', pages: 2 },
        { issuedOn: null, kind: 'rar_authorisation', pages: 1 },
      ],
      id: '6f1d1c1e-0000-4000-8000-000000000001',
      language: 'ro',
      requestedItems: ['photos'],
      status: 'open',
      step: 6,
      token: 'browser-key',
      updatedAt: '2026-10-22T08:00:00.000Z',
    });

    expect(instanceToPlain(copy)).toEqual({
      data: { steps: {} },
      edited: false,
      email: 'radu@example.ro',
      held: [
        { issuedOn: '2026-09-30', kind: 'onrc_certificate', pages: 2 },
        { issuedOn: null, kind: 'rar_authorisation', pages: 1 },
      ],
      id: '6f1d1c1e-0000-4000-8000-000000000001',
      language: 'ro',
      requestedItems: ['photos'],
      status: 'open',
      step: 6,
      token: 'browser-key',
      updatedAt: '2026-10-22T08:00:00.000Z',
    });
  });
});

// @traces 208-FR-001 208-FR-012
describe("the status read's note in the contract", () => {
  it('carries the note, null outside a request for more', () => {
    expect(documented(VerificationStatusDto.prototype, 'note')).toMatchObject({
      nullable: true,
      type: String,
    });
  });
});
