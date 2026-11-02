import {
  type GaragePhotosDto,
  galleryErrors,
  isRecord,
  PHOTOS_MAX,
  photoCaption,
  SaveGaragePhotosDto,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { assertListed, OwnerPhotosService } from './owner-photos.service';
import {
  AUDIT_PORT,
  type AuditEntry,
  type AuditPort,
} from '../../../audit/audit.port';
import { refusal } from '../../../auth/http-refusal';
import type { Actor } from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import { EVENT_PORT, type EventPort } from '../../../events/event.port';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client';
import { StorageService } from '../../../storage/storage.service';
import {
  assertGarageOwner,
  noGarage,
} from '../../garage-brands/garage-brands.service';
import {
  ListingPhotosService,
  type PhotoSize,
} from '../listing-photos/listing-photos.service';

type Locked = { profile_version: number; status: string };
type Row = {
  caption: string | null;
  fileKey: string;
  id: string;
  position: number;
};
type Wanted = { caption: string | null; position: number };
type Kept = Wanted & { row: Row };
type Added = Wanted & { key: string };
type Problem = { code: string; field: string };
type Probe = Map<string, PhotoSize | null>;

const invalid = (errors: Problem[], message: string) =>
  refusal(HttpStatus.BAD_REQUEST, 'validation_failed', message, errors);
const changed = () =>
  refusal(
    HttpStatus.CONFLICT,
    'profile_changed',
    'The profile changed since it was read',
  );
// What the history shows of a photo: its caption and its place, from 1.
const shown = (caption: string | null, position: number) => ({
  caption,
  position: position + 1,
});

// The row locked, so two saves of one garage run one after the other.
async function lockGarage(tx: Prisma.TransactionClient, garageId: string) {
  const [row] = await tx.$queryRaw<Locked[]>`
    SELECT g.status::text AS status, g.profile_version
    FROM garage g WHERE g.id = ${garageId}::uuid FOR UPDATE OF g`;
  if (!row) throw noGarage();
  return row;
}

// The body judged as the API's pipe would, each broken gallery rule named
// by its entry, and every added key one of this garage's own.
function validBody(body: unknown, garageId: string): SaveGaragePhotosDto {
  if (!isRecord(body)) throw invalid([], 'Send the gallery as an object');
  const errors = validateSync(plainToInstance(SaveGaragePhotosDto, body), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).flatMap((e): Problem[] => {
    const named = e.property === 'photos' ? galleryErrors(body['photos']) : [];
    return named.length > 0
      ? named
      : [
          {
            code: Object.keys(e.constraints ?? {})[0] ?? 'invalid',
            field: e.property,
          },
        ];
  });
  const dto = body as unknown as SaveGaragePhotosDto;
  if (errors.length === 0) {
    const own = `garage_photo/${garageId}/`;
    dto.photos.forEach(({ key }, n) => {
      if (key !== undefined && !key.startsWith(own)) {
        errors.push({ code: 'invalid', field: `photos[${n}].key` });
      }
    });
  }
  if (errors.length > 0) throw invalid(errors, 'The gallery breaks a rule');
  return dto;
}

// Every added file stored, then every one processed.
function sizesOf(stored: Probe, keys: string[]): Map<string, PhotoSize> {
  const sizes = keys.map((key) => stored.get(key) ?? null);
  if (sizes.some((size) => size === null)) {
    throw refusal(
      HttpStatus.CONFLICT,
      'file_missing',
      'An added photo was never uploaded or was removed',
    );
  }
  const found = sizes as PhotoSize[];
  if (found.some((size) => size.width === undefined)) {
    throw refusal(
      HttpStatus.CONFLICT,
      'photo_processing',
      'An added photo is still being processed',
    );
  }
  return new Map(found.map((size) => [size.key, size]));
}

// The owner's whole gallery in its new order, in place and with no review.
// Refused in order: who asks, the garage's state, the rules, an unknown
// photo, a missing file, one still processing, then a stale stamp.
@Injectable()
export class OwnerPhotosSave {
  private readonly logger = new Logger(OwnerPhotosSave.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    private readonly storage: StorageService,
    private readonly photos: ListingPhotosService,
    private readonly gallery: OwnerPhotosService,
  ) {}

  async save(
    actor: Actor,
    garageId: string,
    body: unknown,
  ): Promise<GaragePhotosDto> {
    assertGarageOwner(actor, garageId);
    const stored = await this.probe(body, garageId);
    const removed = await this.prisma.$transaction(async (tx) => {
      const locked = await lockGarage(tx, garageId);
      assertListed(locked.status);
      const dto = validBody(body, garageId);
      const rows: Row[] = await tx.garagePhoto.findMany({
        orderBy: { position: 'asc' },
        select: { caption: true, fileKey: true, id: true, position: true },
        where: { garageId },
      });
      const { added, kept } = this.planned(dto, rows);
      const sizes = sizesOf(
        stored,
        added.map((a) => a.key),
      );
      if (dto.version !== String(locked.profile_version)) throw changed();
      const keptIds = new Set(kept.map((k) => k.row.id));
      const gone = rows.filter((row) => !keptIds.has(row.id));
      const moved = kept.filter(
        (k) => k.position !== k.row.position || k.caption !== k.row.caption,
      );
      if (gone.length === 0 && added.length === 0 && moved.length === 0) {
        return [];
      }
      await this.write(tx, actor, garageId, { added, gone, kept, sizes });
      const { count } = await tx.garage.updateMany({
        data: { profileVersion: { increment: 1 } },
        where: { id: garageId, profileVersion: locked.profile_version },
      });
      if (count === 0) throw changed();
      return gone.map((row) => row.fileKey);
    });
    await this.deleteFiles(garageId, removed);
    return this.gallery.answer(garageId);
  }

  // Each sent entry against the gallery: an id it does not hold is refused.
  private planned(dto: SaveGaragePhotosDto, rows: Row[]) {
    const byId = new Map(rows.map((row) => [row.id, row]));
    const kept: Kept[] = [];
    const added: Added[] = [];
    const unknown: Problem[] = [];
    const held = new Set(rows.map((row) => row.fileKey));
    const again: Problem[] = [];
    dto.photos.forEach((entry, position) => {
      const caption = photoCaption(entry.caption);
      if (entry.key !== undefined) {
        if (held.has(entry.key)) {
          again.push({ code: 'duplicate', field: `photos[${position}].key` });
        }
        added.push({ caption, key: entry.key, position });
        return;
      }
      const row = byId.get(entry.id as string);
      if (row) kept.push({ caption, position, row });
      else
        unknown.push({
          code: 'unknown_photo',
          field: `photos[${position}].id`,
        });
    });
    if (again.length > 0) {
      throw invalid(again, 'A photo the gallery holds is kept by its id');
    }
    if (unknown.length > 0) {
      throw refusal(
        HttpStatus.BAD_REQUEST,
        'unknown_photo',
        'The gallery holds no such photo',
        unknown,
      );
    }
    return { added, kept };
  }

  // The files the body adds, read before the garage is locked so slow
  // storage never holds the lock: each one this garage's own and stored, with
  // its size once processed, or null when it was never stored.
  private async probe(body: unknown, garageId: string): Promise<Probe> {
    const own = `garage_photo/${garageId}/`;
    const photos: unknown[] =
      isRecord(body) && Array.isArray(body['photos'])
        ? body['photos'].slice(0, PHOTOS_MAX)
        : [];
    const keys = [
      ...new Set(
        photos.flatMap((entry) =>
          isRecord(entry) &&
          typeof entry['key'] === 'string' &&
          entry['key'].startsWith(own)
            ? [entry['key']]
            : [],
        ),
      ),
    ];
    const meta = await Promise.all(
      keys.map((key) => this.storage.metadataOf(key)),
    );
    const present = keys.filter((_, n) => meta[n] !== null);
    const sizes = new Map(
      (await this.photos.describe(present)).map((size) => [size.key, size]),
    );
    return new Map(keys.map((key) => [key, sizes.get(key) ?? null]));
  }

  // The rows parked past the cap first, as no two may share a place; then
  // the removed go, the kept take their places and the added are inserted,
  // each change in the history and one event for the public profile.
  private async write(
    tx: Prisma.TransactionClient,
    actor: Actor,
    garageId: string,
    plan: {
      added: Added[];
      gone: Row[];
      kept: Kept[];
      sizes: Map<string, PhotoSize>;
    },
  ) {
    const { added, gone, kept, sizes } = plan;
    await tx.garagePhoto.updateMany({
      data: { position: { increment: PHOTOS_MAX } },
      where: { garageId },
    });
    if (gone.length > 0) {
      await tx.garagePhoto.deleteMany({
        where: { garageId, id: { in: gone.map((row) => row.id) } },
      });
    }
    for (const { caption, position, row } of kept) {
      await tx.garagePhoto.update({
        data: { caption, position },
        where: { id: row.id },
      });
    }
    const created =
      added.length === 0
        ? []
        : await tx.garagePhoto.createManyAndReturn({
            data: added.map(({ caption, key, position }) => {
              const size = sizes.get(key);
              return {
                caption,
                fileKey: key,
                garageId,
                height: size?.height ?? null,
                position,
                thumbhash: size?.thumbhash ?? null,
                variantPath: size?.variantPath ?? null,
                width: size?.width ?? null,
              };
            }),
            select: { caption: true, id: true, position: true },
          });
    const base = {
      actorId: actor.accountId,
      actorRole: actor.role,
      garageId,
      subjectType: 'garage_photo',
    } as const;
    const entries: AuditEntry[] = [
      ...gone.map(
        (row): AuditEntry => ({
          ...base,
          action: 'delete',
          oldValue: shown(row.caption, row.position),
          subjectId: row.id,
        }),
      ),
      ...kept.flatMap(({ caption, position, row }) => {
        const change = (field: string): AuditEntry => ({
          ...base,
          action: 'update',
          field,
          newValue: shown(caption, position),
          oldValue: shown(row.caption, row.position),
          subjectId: row.id,
        });
        return [
          ...(caption !== row.caption ? [change('caption')] : []),
          ...(position !== row.position ? [change('position')] : []),
        ];
      }),
      ...created.map(
        (row): AuditEntry => ({
          ...base,
          action: 'create',
          newValue: shown(row.caption, row.position),
          subjectId: row.id,
        }),
      ),
    ];
    await this.audit.recordMany(tx, entries);
    await this.events.record(tx, {
      audience: { garageId, results: false, type: 'public_garage' },
      kind: 'garage.updated',
      payload: { fields: ['photos'], garageId },
      subjectId: garageId,
    });
  }

  // After the commit: a file that will not go is left, and logged, for the
  // stored-files sweep; the gallery is already saved.
  private async deleteFiles(garageId: string, keys: string[]) {
    for (const key of keys) {
      await this.storage.deleteWithCopies(key).catch((error: unknown) => {
        this.logger.error(
          `A removed photo of garage ${garageId} kept its file: ${String(error)}`,
        );
      });
    }
  }
}
