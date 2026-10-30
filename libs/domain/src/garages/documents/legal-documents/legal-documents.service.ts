import {
  DOCUMENT_KINDS,
  DOWNLOAD_URL_MINUTES,
  type DocumentKind,
  type DocumentPageAddressDto,
  type DraftDocuments,
  declarationDone,
  isDocumentKind,
  type ListingDraftData,
} from '@motor-fix/contracts';
import { capabilitiesOf } from '@motor-fix/contracts/capabilities';
import {
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';

import { AUDIT_PORT, type AuditPort } from '../../../audit/audit.port';
import { refusal } from '../../../auth/http-refusal';
import type { Actor } from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import { EVENT_PORT, type EventPort } from '../../../events/event.port';
import type {
  LegalDocument,
  Prisma,
  PrismaClient,
} from '../../../generated/prisma/client';
import { countDocumentOpened } from '../../../metrics/product-counters';
import { StorageService } from '../../../storage/storage.service';
import type { VerificationActor } from '../../verification/verification.service';

const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

const PAGE = /^[1-9]\d{0,2}$/;

// The legal documents a listing was sent with, kept on its verification
// file: written once when the listing is sent, then opened page by page by
// an admin through short-lived addresses.
@Injectable()
export class LegalDocumentsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    private readonly storage: StorageService,
  ) {}

  // In the sender's transaction: any failure, a second attach included
  // (one row per kind and file), fails the send. The pages keep their keys.
  async attach(
    tx: Prisma.TransactionClient,
    actor: VerificationActor,
    draftData: ListingDraftData,
    file: { id: string; garageId: string },
  ): Promise<LegalDocument[]> {
    if (!declarationDone(draftData)) {
      throw refusal(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'declaration_missing',
        'The declaration is not signed',
      );
    }
    const by = { actorId: actor.accountId, actorRole: actor.role };
    const created: LegalDocument[] = [];
    for (const kind of DOCUMENT_KINDS) {
      const document = draftData.documents?.[kind];
      if (!document?.pages.length) continue;
      created.push(await this.add(tx, actor, file, kind, document, null));
    }
    await tx.verificationFile.update({
      data: {
        declaredAt: draftData.declaredAt,
        declaredByName: draftData.declaredByName?.trim(),
      },
      where: { id: file.id },
    });
    await this.audit.record(tx, {
      ...by,
      action: 'update',
      field: 'declared_at',
      garageId: file.garageId,
      newValue: draftData.declaredAt,
      oldValue: null,
      subjectId: file.id,
      subjectType: 'verification_file',
    });
    return created;
  }

  // In the resend's transaction: each kind the copy holds pages of becomes
  // the file's current document, the one it replaces kept with its
  // `replacedAt`. A kind the copy holds no page of is left as it is.
  async replace(
    tx: Prisma.TransactionClient,
    actor: VerificationActor,
    documents: DraftDocuments | undefined,
    file: { id: string; garageId: string },
  ): Promise<LegalDocument[]> {
    const created: LegalDocument[] = [];
    for (const kind of DOCUMENT_KINDS) {
      const document = documents?.[kind];
      if (!document?.pages.length) continue;
      const old = await tx.legalDocument.findFirst({
        where: { kind, replacedAt: null, verificationFileId: file.id },
      });
      created.push(await this.add(tx, actor, file, kind, document, old));
    }
    return created;
  }

  // In the transaction of a sending after a rejection: each kind the copy
  // holds pages of becomes the new file's document; each other kind the
  // rejected file holds is carried onto the new file as a row of its own,
  // with no event (no upload happened). The rejected file's rows stay as
  // the decision left them.
  async carry(
    tx: Prisma.TransactionClient,
    actor: VerificationActor,
    from: { id: string },
    to: { id: string; garageId: string },
    documents: DraftDocuments | undefined,
  ): Promise<LegalDocument[]> {
    const created: LegalDocument[] = [];
    for (const kind of DOCUMENT_KINDS) {
      const document = documents?.[kind];
      if (document?.pages.length) {
        created.push(await this.add(tx, actor, to, kind, document, null));
        continue;
      }
      const held = await tx.legalDocument.findFirst({
        where: {
          kind,
          replacedAt: null,
          status: 'valid',
          verificationFileId: from.id,
        },
      });
      if (!held) continue;
      const row = await tx.legalDocument.create({
        data: {
          issuedOn: held.issuedOn,
          kind,
          pages: held.pages,
          verificationFileId: to.id,
        },
      });
      await this.audit.record(tx, {
        action: 'create',
        actorId: actor.accountId,
        actorRole: actor.role,
        garageId: to.garageId,
        kind,
        newValue: { carriedFrom: held.id, kind, pages: held.pages.length },
        subjectId: row.id,
        subjectType: 'legal_document',
      });
      created.push(row);
    }
    return created;
  }

  // In the yearly upload's transaction: each document waits for an admin
  // beside the kind's valid one, which stays current until it is accepted.
  async renew(
    tx: Prisma.TransactionClient,
    actor: VerificationActor,
    documents: readonly {
      kind: DocumentKind;
      issuedOn: string;
      pages: string[];
    }[],
    file: { id: string; garageId: string },
  ): Promise<LegalDocument[]> {
    const created: LegalDocument[] = [];
    for (const { kind, ...document } of documents) {
      created.push(await this.add(tx, actor, file, kind, document, null, true));
    }
    return created;
  }

  // One document's row, the mark on the one it replaces if any, its audit
  // entry and its event: a listing's to the admins alone, a yearly upload's
  // to the garage too.
  private async add(
    tx: Prisma.TransactionClient,
    actor: VerificationActor,
    file: { id: string; garageId: string },
    kind: DocumentKind,
    document: { issuedOn?: string; pages: string[] },
    old: LegalDocument | null,
    renewal = false,
  ): Promise<LegalDocument> {
    if (old) {
      await tx.legalDocument.update({
        data: { replacedAt: new Date() },
        where: { id: old.id },
      });
    }
    const row = await tx.legalDocument.create({
      data: {
        issuedOn: document.issuedOn ? new Date(document.issuedOn) : null,
        kind,
        pages: document.pages,
        ...(renewal && { status: 'in_review' }),
        verificationFileId: file.id,
      },
    });
    await this.audit.record(tx, {
      action: old ? 'update' : 'create',
      actorId: actor.accountId,
      actorRole: actor.role,
      garageId: file.garageId,
      kind,
      newValue: {
        issuedOn: document.issuedOn,
        kind,
        pages: document.pages.length,
      },
      subjectId: row.id,
      subjectType: 'legal_document',
    });
    await this.events.record(tx, {
      audience: renewal
        ? { garageId: file.garageId, type: 'verification' }
        : { adminOnly: true, type: 'platform' },
      kind: 'document.uploaded',
      payload: { documentId: row.id, garageId: file.garageId, kind },
      subjectId: row.id,
    });
    return row;
  }

  // The garage's own staff are told they are not admins; anyone else, and
  // anything unknown, a page gone from storage included, is not found. No
  // address is issued without its entry.
  async pageAddress(
    actor: Actor,
    fileId: string,
    documentId: string,
    n: string,
  ): Promise<DocumentPageAddressDto> {
    const admin = capabilitiesOf(actor.role, actor.permissions).includes(
      'admin.garages',
    );
    if (!admin && !actor.garageId) throw new NotFoundException();
    if (!isUUID(fileId) || !isUUID(documentId)) throw new NotFoundException();
    const page = PAGE.test(n) ? Number(n) : 0;
    // One transaction: the read that resolves the document and its open
    // entry; a page gone from storage rolls both back.
    const { contentType, key, kind } = await this.prisma.$transaction(
      async (tx) => {
        const document = await this.readable(
          tx,
          actor,
          admin,
          fileId,
          documentId,
        );
        const key = document.pages[page - 1];
        if (!key) throw new NotFoundException();
        const contentType = await this.storage.contentTypeOf(key);
        if (!contentType) throw new NotFoundException();
        await this.audit.record(tx, {
          action: 'open',
          actorId: actor.accountId,
          actorRole: actor.role,
          garageId: document.verificationFile.garageId,
          kind: document.kind,
          newValue: { page },
          subjectId: document.id,
          subjectType: 'legal_document',
        });
        return { contentType, key, kind: document.kind };
      },
    );
    const extension = EXTENSIONS[contentType];
    const expiresAt = new Date(
      Date.now() + DOWNLOAD_URL_MINUTES * 60_000,
    ).toISOString();
    const url = await this.storage.createDownloadUrl(
      key,
      extension ? `${kind}-${page}.${extension}` : `${kind}-${page}`,
      'inline',
      DOWNLOAD_URL_MINUTES,
    );
    if (isDocumentKind(kind)) countDocumentOpened(kind);
    return { expiresAt, url };
  }

  private async readable(
    tx: Prisma.TransactionClient,
    actor: Actor,
    admin: boolean,
    fileId: string,
    documentId: string,
  ) {
    const document = await tx.legalDocument.findFirst({
      include: { verificationFile: { select: { garageId: true } } },
      where: { id: documentId, verificationFileId: fileId },
    });
    if (!document) throw new NotFoundException();
    if (admin) return document;
    if (actor.garageId !== document.verificationFile.garageId) {
      throw new NotFoundException();
    }
    throw refusal(
      HttpStatus.FORBIDDEN,
      'not_admin',
      'Only a MotorFix admin opens the documents',
    );
  }
}
