import {
  DOCUMENT_PAGES_MAX,
  type DocumentKind,
  type DocumentUploadAddressDto,
  type DraftDocumentDto,
  type DraftDocuments,
  isDocumentKind,
  isListingDraftData,
} from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import { PRISMA } from '../../../auth/prisma';
import { refusal } from '../../../auth/sign-up.service';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client';
import { countDocumentUploaded } from '../../../metrics/product-counters';
import { StorageService } from '../../../storage/storage.service';
import { ListingDraftsService } from '../../listing-drafts/listing-drafts.service';

const PURPOSE = 'legal_document';

const full = () =>
  refusal(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'document_full',
    `A document holds at most ${DOCUMENT_PAGES_MAX} pages`,
  );
const submitted = () =>
  refusal(
    HttpStatus.CONFLICT,
    'draft_submitted',
    'This listing was already sent',
  );
const held = () =>
  refusal(HttpStatus.CONFLICT, 'file_missing', 'The draft holds this page');

function checkedKind(kind: string): DocumentKind {
  if (!isDocumentKind(kind)) {
    throw refusal(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'document_kind_unknown',
      'No such kind of document',
    );
  }
  return kind;
}

const documentsOf = (data: unknown): DraftDocuments =>
  isListingDraftData(data) ? (data.documents ?? {}) : {};
const pagesOf = (data: unknown, kind: DocumentKind) =>
  documentsOf(data)[kind]?.pages ?? [];
const withDocuments = (data: unknown, documents: DraftDocuments) =>
  ({ ...(data as object), documents }) satisfies Prisma.InputJsonObject;

// The pages of a draft's legal documents: the browser uploads straight to
// storage with an address issued here, and the draft keeps the confirmed
// keys in its data, per kind, in the owner's order. Nothing is processed.
@Injectable()
export class ListingDocumentsService {
  private readonly logger = new Logger('ListingDocumentsService');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly drafts: ListingDraftsService,
    private readonly storage: StorageService,
  ) {}

  async uploadAddress(
    id: string,
    kind: string,
    token: string | undefined,
    file: { contentType: string; size: number },
  ): Promise<DocumentUploadAddressDto> {
    const draft = await this.drafts.open(id, token);
    if (pagesOf(draft.data, checkedKind(kind)).length >= DOCUMENT_PAGES_MAX)
      throw full();
    return this.storage.createUpload(PURPOSE, id, file.contentType, file.size);
  }

  // The cap is checked again, binding, under the row lock: two confirms at
  // once count one after the other. A refused upload is deleted.
  async confirm(
    id: string,
    kind: string,
    token: string | undefined,
    incoming: string,
  ): Promise<DraftDocumentDto> {
    const ours = incoming.startsWith(`incoming/${PURPOSE}/${id}/`);
    const draft = await this.drafts.open(id, token).catch(async (error) => {
      if (ours && error instanceof HttpException && error.getStatus() === 409)
        await this.discard(incoming);
      throw error;
    });
    const known = checkedKind(kind);
    if (pagesOf(draft.data, known).length >= DOCUMENT_PAGES_MAX) {
      if (ours) await this.discard(incoming);
      throw full();
    }
    const key = await this.storage.confirmUpload(incoming, PURPOSE, id);
    let kept = false;
    const document = await this.prisma
      .$transaction(async (tx) => {
        const row = await locked(tx, id);
        if (row.status === 'submitted') throw submitted();
        const documents = documentsOf(row.data);
        // A second confirm that passed storage alongside the first.
        if (
          Object.values(documents).some((each) => each?.pages.includes(key))
        ) {
          kept = true;
          throw held();
        }
        const pages = documents[known]?.pages ?? [];
        if (pages.length >= DOCUMENT_PAGES_MAX) throw full();
        const next = { ...documents[known], pages: [...pages, key] };
        await tx.listingDraft.update({
          data: {
            data: withDocuments(row.data, { ...documents, [known]: next }),
          },
          where: { id },
        });
        return next;
      })
      .catch(async (error) => {
        if (!kept)
          await this.storage.deleteWithCopies(key).catch(() => undefined);
        throw error;
      });
    countDocumentUploaded(known);
    return { kind: known, ...document };
  }

  // The key leaves the draft even when storage cannot delete the file: the
  // orphan is logged rather than kept in the owner's document.
  async remove(
    id: string,
    kind: string,
    token: string | undefined,
    key: string,
  ): Promise<void> {
    await this.drafts.open(id, token);
    const known = checkedKind(kind);
    await this.prisma.$transaction(async (tx) => {
      const row = await locked(tx, id);
      if (row.status === 'submitted') throw submitted();
      const { [known]: document, ...others } = documentsOf(row.data);
      if (!document?.pages.includes(key)) {
        throw refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such page');
      }
      const pages = document.pages.filter((each) => each !== key);
      await tx.listingDraft.update({
        data: {
          data: withDocuments(
            row.data,
            pages.length
              ? { ...others, [known]: { ...document, pages } }
              : others,
          ),
        },
        where: { id },
      });
    });
    await this.storage.deleteWithCopies(key).catch((error: unknown) => {
      this.logger.error(
        `document page of draft ${id} left in storage: ${key}: ${String(error)}`,
      );
    });
  }

  private discard(key: string) {
    return this.storage.deleteObject(key).catch((error: unknown) => {
      this.logger.warn(`could not delete ${key}: ${String(error)}`);
    });
  }
}

async function locked(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM listing_draft WHERE id = ${id}::uuid FOR UPDATE`;
  return tx.listingDraft.findUniqueOrThrow({ where: { id } });
}
