import {
  DOCUMENT_KINDS,
  DOWNLOAD_URL_MINUTES,
  type DocumentPageAddressDto,
  declarationDone,
  isDocumentKind,
  type ListingDraftData,
} from '@motor-fix/contracts';
import {
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';

import { AUDIT_PORT, type AuditPort } from '../../../audit/audit.port';
import { capabilitiesOf } from '../../../auth/capabilities';
import type { Actor } from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import { refusal } from '../../../auth/sign-up.service';
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
      const row = await tx.legalDocument.create({
        data: {
          issuedOn: document.issuedOn ? new Date(document.issuedOn) : null,
          kind,
          pages: document.pages,
          verificationFileId: file.id,
        },
      });
      await this.audit.record(tx, {
        ...by,
        action: 'create',
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
        audience: { adminOnly: true, type: 'platform' },
        kind: 'document.uploaded',
        payload: { documentId: row.id, garageId: file.garageId, kind },
        subjectId: row.id,
      });
      created.push(row);
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
    const document = await this.readable(
      this.prisma,
      actor,
      admin,
      fileId,
      documentId,
    );
    const { kind } = document;
    const key = document.pages[page - 1];
    if (!key) throw new NotFoundException();
    const contentType = await this.storage.contentTypeOf(key);
    if (!contentType) throw new NotFoundException();
    await this.prisma.$transaction((tx) =>
      this.audit.record(tx, {
        action: 'open',
        actorId: actor.accountId,
        actorRole: actor.role,
        garageId: document.verificationFile.garageId,
        kind,
        newValue: { page },
        subjectId: document.id,
        subjectType: 'legal_document',
      }),
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
