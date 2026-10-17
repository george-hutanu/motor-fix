import {
  DOCUMENT_KINDS,
  issuedWithinWindow,
  VERIFICATION_CHECK_KINDS,
  VERIFICATION_TIMELINE_MAX,
  type VerificationActorDto,
  type VerificationFileDto,
} from '@motor-fix/contracts';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { firstName } from '../../../audit/audit.service';
import { auditEntryOf } from '../../../audit/audit-history/audit-history.service';
import { PRISMA } from '../../../auth/prisma';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client';
import { StorageService } from '../../../storage/storage.service';
import { PublicGaragesService } from '../../public-garages/public-garages';

const SYSTEM_NAME = 'MotorFix';

const calendarDay = (at: Date) => at.toISOString().slice(0, 10);

const bucharestDay = (at: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
  }).format(at);

// The certificate counts from the day it was sent, in Bucharest; one with no
// issue date cannot be judged recent.
export function certificateStale(issuedOn: Date | null, sentAt: Date) {
  if (!issuedOn) return true;
  return !issuedWithinWindow(calendarDay(issuedOn), bucharestDay(sentAt));
}

// The file's own lines: its sending and status changes, its checks' records
// and its documents' openings. A document upload and the declaration stay out.
// Every one of them carries the garage, so the (garageId, at) index reads it.
export function timelineWhere(
  garageId: string,
  fileId: string,
  checkIds: string[],
  documentIds: string[],
): Prisma.ActivityLogWhereInput {
  return {
    garageId,
    OR: [
      {
        OR: [{ action: 'create' }, { action: 'update', field: 'status' }],
        subjectId: fileId,
        subjectType: 'verification_file',
      },
      { subjectId: { in: checkIds }, subjectType: 'verification_check' },
      {
        action: 'open',
        subjectId: { in: documentIds },
        subjectType: 'legal_document',
      },
    ],
  };
}

const iso = (at: Date | null) => at?.toISOString() ?? null;

// Everything an admin reads to decide one verification file, in one answer.
// It writes nothing: the opening is the open use case's.
@Injectable()
export class VerificationFileService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly storage: StorageService,
    private readonly publicGarages: PublicGaragesService,
  ) {}

  async read(id: string): Promise<VerificationFileDto> {
    // PostgreSQL refuses a malformed uuid outright; it is an unknown id.
    if (!isUUID(id)) throw new NotFoundException();
    const storageReady = this.storage.ready().then(
      () => true,
      () => false,
    );
    const file = await this.prisma.verificationFile.findUnique({
      include: {
        checks: true,
        documents: true,
        garage: {
          include: {
            brands: {
              include: { brand: { select: { name: true } } },
              where: { stance: 'works_on' },
            },
            photos: {
              orderBy: { position: 'asc' },
              select: { fileKey: true, height: true, id: true, width: true },
            },
          },
        },
        previousFile: {
          select: {
            decidedAt: true,
            reasonCode: true,
            reasonNote: true,
            status: true,
          },
        },
      },
      where: { id },
    });
    if (!file) throw new NotFoundException();
    const { garage } = file;

    const where = timelineWhere(
      garage.id,
      file.id,
      file.checks.map((c) => c.id),
      file.documents.map((d) => d.id),
    );
    const [names, activities, reports, entries, total, photos] =
      await Promise.all([
        this.names([
          file.openedBy,
          file.decidedBy,
          file.reopenedBy,
          ...file.checks.map((c) => c.recordedBy),
        ]),
        this.prisma.rarActivity.findMany({
          orderBy: { code: 'asc' },
          where: { code: { in: garage.rarActivities } },
        }),
        this.prisma.garageReport.findMany({
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, text: true },
          where: { garageId: garage.id, status: 'open' },
        }),
        this.prisma.activityLog.findMany({
          orderBy: [{ at: 'desc' }, { id: 'desc' }],
          take: VERIFICATION_TIMELINE_MAX,
          where,
        }),
        this.prisma.activityLog.count({ where }),
        this.publicGarages.photos(garage.photos),
      ]);
    const actor = (
      accountId: string | null,
      at: Date | null,
    ): VerificationActorDto | null =>
      at ? { id: accountId, name: names(accountId) } : null;
    const previous = file.previousFile;

    return {
      activities: activities.map(({ code, nameEn, nameRo }) => ({
        code,
        nameEn,
        nameRo,
      })),
      checks: [...file.checks]
        .sort(
          (a, b) =>
            VERIFICATION_CHECK_KINDS.indexOf(a.kind) -
            VERIFICATION_CHECK_KINDS.indexOf(b.kind),
        )
        .map(
          ({
            automatic,
            detail,
            fileId,
            id,
            kind,
            recordedAt,
            recordedBy,
            result,
          }) => ({
            automatic,
            detail,
            fileId,
            id,
            kind,
            recordedAt,
            recordedBy,
            recorder: actor(recordedBy, recordedAt),
            result,
          }),
        ),
      documents: DOCUMENT_KINDS.map((kind) => {
        const held = file.documents.find((d) => d.kind === kind);
        const issuedOn = held?.issuedOn ?? null;
        return {
          id: held?.id ?? null,
          issuedOn: issuedOn && calendarDay(issuedOn),
          kind,
          pages: held?.pages.length ?? 0,
          present: Boolean(held),
          stale:
            held && kind === 'onrc_certificate'
              ? certificateStale(issuedOn, file.submittedAt)
              : null,
        };
      }),
      file: {
        decidedAt: iso(file.decidedAt),
        decidedBy: actor(file.decidedBy, file.decidedAt),
        declaredAt: iso(file.declaredAt),
        declaredByName: file.declaredByName,
        id: file.id,
        openedAt: iso(file.openedAt),
        openedBy: actor(file.openedBy, file.openedAt),
        reasonCode: file.reasonCode,
        reasonNote: file.reasonNote,
        reopenedAt: iso(file.reopenedAt),
        reopenedBy: actor(file.reopenedBy, file.reopenedAt),
        reopenReason: file.reopenReason,
        status: file.status,
        submittedAt: file.submittedAt.toISOString(),
      },
      garage: {
        address: garage.address,
        brands: garage.brands
          .map((b) => b.brand.name)
          .sort((a, b) => a.localeCompare(b, 'ro')),
        businessKind: garage.businessKind,
        cui: garage.cui,
        id: garage.id,
        name: garage.name,
        phone: garage.phone,
        photos,
        seatAddress: garage.seatAddress,
        serviceRadiusKm: garage.serviceRadiusKm,
      },
      previousRejection:
        previous?.status === 'rejected' && previous.decidedAt
          ? {
              decidedAt: previous.decidedAt.toISOString(),
              reasonCode: previous.reasonCode,
              reasonNote: previous.reasonNote,
            }
          : null,
      reports: reports.map((r) => ({
        createdAt: r.createdAt.toISOString(),
        text: r.text,
      })),
      storageReady: await storageReady,
      timeline: {
        entries: entries.map((row) => {
          const entry = auditEntryOf(row, true);
          return row.actorRole === 'system'
            ? { ...entry, actor: { ...entry.actor, name: SYSTEM_NAME } }
            : entry;
        }),
        total,
      },
    };
  }

  // First names by account; the system, which has none, is MotorFix.
  private async names(ids: (string | null)[]) {
    const wanted = ids.filter((id): id is string => id !== null);
    const accounts = wanted.length
      ? await this.prisma.account.findMany({
          select: { id: true, name: true },
          where: { id: { in: wanted } },
        })
      : [];
    const byId = new Map(accounts.map((a) => [a.id, firstName(a.name)]));
    return (id: string | null) =>
      id === null ? SYSTEM_NAME : (byId.get(id) ?? '');
  }
}
