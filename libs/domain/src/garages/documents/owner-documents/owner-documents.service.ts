import {
  DOCUMENT_KINDS,
  type DocumentCycleDto,
  type DocumentKind,
  type DocumentsSubmitDto,
  type DocumentUploadAddressDto,
  type DocumentUploadRequestDto,
  issuedWithinWindow,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';

import { refusal } from '../../../auth/http-refusal';
import type { Actor } from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import { localDay } from '../../../bucharest';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client';
import { countDocumentCycle } from '../../../metrics/product-counters';
import { NotificationsService } from '../../../notifications/notifications.service';
import { RateLimits } from '../../../rate-limit/rate-limit.service';
import { StorageService } from '../../../storage/storage.service';
import {
  DocumentCycleService,
  inReviewWhere,
} from '../document-cycle/document-cycle.service';
import { LegalDocumentsService } from '../legal-documents/legal-documents.service';

export const OWNER_DOCUMENTS_WEB_URL = Symbol('OWNER_DOCUMENTS_WEB_URL');

const PURPOSE = 'legal_document';

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such garage');
const inReview = () =>
  refusal(
    HttpStatus.CONFLICT,
    'document_in_review',
    'A document waits for an admin',
  );

type Db = PrismaClient | Prisma.TransactionClient;

// The owner's yearly upload of the garage's documents: pages go straight to
// storage through addresses issued here, then one confirm stores them as
// documents waiting for an admin, beside the valid ones they will replace.
@Injectable()
export class OwnerDocumentsService {
  private readonly logger = new Logger('OwnerDocuments');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly documents: LegalDocumentsService,
    private readonly cycles: DocumentCycleService,
    private readonly storage: StorageService,
    private readonly limits: RateLimits,
    private readonly notifications: NotificationsService,
    @Inject(OWNER_DOCUMENTS_WEB_URL)
    private readonly webUrl: string | undefined,
  ) {}

  async uploadAddress(
    actor: Actor,
    garageId: string,
    file: DocumentUploadRequestDto,
  ): Promise<DocumentUploadAddressDto> {
    await this.garageOf(actor, garageId);
    await this.limits.take('uploadUrl', garageId);
    // Nothing is left to send while both kinds wait for an admin; one kind in
    // review still lets the other be uploaded alone.
    const waiting = await this.prisma.legalDocument.findMany({
      distinct: ['kind'],
      select: { kind: true },
      where: inReviewWhere(garageId),
    });
    if (waiting.length >= DOCUMENT_KINDS.length) throw inReview();
    return this.storage.createUpload(
      PURPOSE,
      garageId,
      file.contentType,
      file.size,
      file.checksum,
    );
  }

  // The rules are read before any page moves, so a refusal keeps the
  // uploads for a retry, and again under the cycle's lock; a page moved for a
  // refused upload is deleted.
  async submit(
    actor: Actor,
    garageId: string,
    body: DocumentsSubmitDto,
  ): Promise<DocumentCycleDto | null> {
    const garage = await this.garageOf(actor, garageId);
    const today = localDay(new Date());
    for (const document of body.documents) {
      if (
        document.kind === 'onrc_certificate' &&
        !issuedWithinWindow(document.issuedOn, today)
      ) {
        throw refusal(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'certificate_too_old',
          'The certificate must be issued within the last 30 days',
        );
      }
    }
    const kinds = body.documents.map((d) => d.kind);
    await this.check(this.prisma, garageId, kinds);
    const moved: string[] = [];
    try {
      const documents: {
        issuedOn: string;
        kind: DocumentKind;
        pages: string[];
      }[] = [];
      for (const document of body.documents) {
        const pages: string[] = [];
        for (const page of document.pages) {
          const key = await this.storage.confirmUpload(page, PURPOSE, garageId);
          moved.push(key);
          pages.push(key);
        }
        documents.push({ ...document, pages });
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM garage_document_cycle WHERE garage_id = ${garageId}::uuid FOR UPDATE`;
        await this.check(tx, garageId, kinds);
        await this.documents.renew(tx, actor, documents, {
          garageId,
          id: garage.fileId,
        });
      });
    } catch (error) {
      for (const key of moved) {
        await this.storage.deleteObject(key).catch((e: unknown) => {
          this.logger.warn(`could not delete ${key}: ${String(e)}`);
        });
      }
      throw error;
    }
    countDocumentCycle('uploaded');
    this.logger.log(
      `yearly documents of garage ${garageId} sent: ${kinds.join(', ')}`,
    );
    await this.tellAdmins(garage, moved[0] as string);
    return this.cycles.documentCycleOf(garageId);
  }

  // The garage's owner alone: its receptionist or mechanic is told so; anyone
  // else, a malformed id included, and a garage never approved, is not found.
  private async garageOf(actor: Actor, garageId: string) {
    if (actor.garageId !== garageId) throw notFound();
    if (actor.role !== 'garage') {
      throw refusal(
        HttpStatus.FORBIDDEN,
        'not_owner',
        "Only the garage's owner sends its documents",
      );
    }
    const garage = await this.prisma.garage.findUnique({
      select: {
        documentCycle: { select: { id: true } },
        name: true,
        status: true,
        verificationFiles: {
          orderBy: { createdAt: 'desc' },
          select: { id: true },
          take: 1,
        },
      },
      where: { id: garageId },
    });
    const file = garage?.verificationFiles[0];
    if (
      (garage?.status !== 'approved' && garage?.status !== 'suspended') ||
      !garage.documentCycle ||
      !file
    ) {
      throw notFound();
    }
    return { fileId: file.id, id: garageId, name: garage.name };
  }

  // A kind sent must not be in review already; a kind left out must be
  // accepted since the cycle was last reset, or be in review.
  private async check(db: Db, garageId: string, kinds: DocumentKind[]) {
    const [cycle, rows] = await Promise.all([
      db.documentCycle.findUniqueOrThrow({ where: { garageId } }),
      db.legalDocument.findMany({
        select: { decidedAt: true, kind: true, status: true },
        where: {
          OR: [{ status: 'in_review' }, { replacedAt: null, status: 'valid' }],
          verificationFile: { garageId },
        },
      }),
    ]);
    if (
      rows.some(
        (r) =>
          r.status === 'in_review' && kinds.includes(r.kind as DocumentKind),
      )
    )
      throw inReview();
    const covered = (kind: DocumentKind) =>
      rows.some(
        (r) =>
          r.kind === kind &&
          (r.status === 'in_review' ||
            (r.decidedAt !== null && r.decidedAt >= cycle.resetAt)),
      );
    if (
      DOCUMENT_KINDS.some((kind) => !kinds.includes(kind) && !covered(kind))
    ) {
      throw refusal(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'both_documents_required',
        'Upload both documents',
      );
    }
  }

  // Every active admin, once per upload: the event id is the upload's first
  // page. The upload stands if this fails; the queue still lists it.
  private async tellAdmins(
    garage: { fileId: string; id: string; name: string },
    firstPage: string,
  ) {
    try {
      if (!this.webUrl) throw new Error('PUBLIC_WEB_URL is not set');
      const admins = await this.prisma.account.findMany({
        select: { id: true },
        where: { roles: { some: { role: 'admin' } }, status: 'active' },
      });
      if (admins.length === 0) return;
      await this.notifications.notify({
        eventId: `documents-uploaded-${firstPage}`,
        kind: 'ADMIN_VERIFICATION_QUEUED',
        params: {
          dashboard: `${this.webUrl}/app/admin`,
          garage: garage.name,
          item: 'documents',
        },
        recipients: admins.map(({ id }) => id),
        subjectId: garage.fileId,
      });
    } catch (error) {
      this.logger.error(
        `admins not told of the yearly documents of garage ${garage.id}: ${String(error)}`,
      );
    }
  }
}
