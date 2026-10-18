import type {
  BusinessKind,
  SavedGarageBrandDto,
  SavedGarageDto,
  SavedGarageIdsDto,
  SavedGarageItemDto,
  SavedGaragesPageDto,
  SavedGaragesQueryDto,
} from '@motor-fix/contracts';
import { MOBILE_SERVICE_RADIUS_DEFAULT_KM } from '@motor-fix/contracts/place-section';
import { parseNear, type SearchPoint } from '@motor-fix/contracts/search-place';
import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';

import {
  AUDIT_PORT,
  type AuditEntry,
  type AuditPort,
} from '../../audit/audit.port';
import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import {
  type DomainEvent,
  EVENT_PORT,
  type EventPort,
} from '../../events/event.port';
import { publicGarages } from '../../garages/public-garages/public-garages';
import {
  Prisma,
  type PrismaClient,
  type SavedGarage,
} from '../../generated/prisma/client';
import { distanceMetersSql } from '../../search/area/search-area';

// Whether the save made the row, so the controller answers 201 or 200.
type Saved = { created: boolean; row: SavedGarageDto };
type Key = { accountId: string; garageId: string };

const answer = (row: SavedGarage): SavedGarageDto => ({
  garageId: row.garageId,
  savedAt: row.savedAt.toISOString(),
});

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

type Change = 'added' | 'removed';

const entry = (
  actor: Actor,
  change: Change,
  row: SavedGarageDto,
): AuditEntry => ({
  action: change === 'added' ? 'create' : 'delete',
  actorId: actor.accountId,
  actorRole: actor.role,
  [change === 'added' ? 'newValue' : 'oldValue']: row,
  subjectId: row.garageId,
  subjectType: 'saved_garage',
});

// To the driver's own channel only: no garage learns who saved it.
const event = (
  actor: Actor,
  change: Change,
  row: SavedGarageDto,
): DomainEvent => ({
  audience: { accountId: actor.accountId, type: 'account' },
  kind: `saved_garage.${change}`,
  payload: { accountId: actor.accountId, ...row },
  subjectId: row.garageId,
});

const PAGE = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Cursor = { at: Date; id: string };

// The last row of a page, as the next page's opaque starting point.
export const cursorOf = (row: { garageId: string; savedAt: Date }) =>
  Buffer.from(
    JSON.stringify({ at: row.savedAt.toISOString(), id: row.garageId }),
  ).toString('base64url');

const badCursor = () =>
  refusal(
    HttpStatus.BAD_REQUEST,
    'invalid_cursor',
    'The cursor is not one this list gave out',
  );

// Only the shape `cursorOf` writes, so no year PostgreSQL cannot hold
// reaches the query.
const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function readCursor(text: string): Cursor {
  let read: unknown;
  try {
    read = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
  } catch {
    throw badCursor();
  }
  const { at, id } = (read ?? {}) as Record<string, unknown>;
  const time =
    typeof at === 'string' && CURSOR_TIME.test(at) ? new Date(at) : undefined;
  if (
    typeof read !== 'object' ||
    !time ||
    Number.isNaN(time.getTime()) ||
    typeof id !== 'string' ||
    !UUID.test(id)
  ) {
    throw badCursor();
  }
  return { at: time, id };
}

// The driver's live cars whose brand the garage works on with that car's
// fuel ticked (OD-15); the garage is the outer query's `garage` row.
const workingCars = (accountId: string) => Prisma.sql`
  FROM car
  JOIN garage_brand gb
    ON gb.brand_id = car.brand_id AND gb.garage_id = garage.id
  WHERE car.owner_id = ${accountId}::uuid
    AND car.removed_at IS NULL
    AND gb.stance = 'works_on'
    AND CASE car.fuel
      WHEN 'petrol' THEN gb.petrol
      WHEN 'diesel' THEN gb.diesel
      WHEN 'hybrid' THEN gb.hybrid
      ELSE gb.electric
    END`;

type ListRow = {
  available: boolean;
  brands: SavedGarageBrandDto[];
  business_kind: BusinessKind | null;
  distance_m: number | null;
  garage_id: string;
  mobile: boolean;
  name: string;
  radius_km: number;
  rating: number | null;
  review_count: number;
  saved_at: Date;
  slug: string;
};

// Distance only for a fixed garage with a position; a mobile mechanic's
// would tell where its seat is, so it only says whether it comes.
function placed(row: ListRow, point: SearchPoint | undefined) {
  if (!point) return {};
  const at = row.distance_m === null ? null : Number(row.distance_m);
  if (row.mobile) {
    return {
      comesToYou: at !== null && at <= row.radius_km * 1000,
      distanceKm: null,
    };
  }
  return { distanceKm: at === null ? null : Math.round(at / 100) / 10 };
}

const itemOf = (
  row: ListRow,
  point: SearchPoint | undefined,
): SavedGarageItemDto => ({
  available: row.available,
  brands: row.brands,
  businessKind: row.business_kind,
  garageId: row.garage_id,
  name: row.name,
  rating: row.rating === null ? null : Number(row.rating),
  reviewCount: row.review_count,
  savedAt: row.saved_at.toISOString(),
  slug: row.slug,
  ...placed(row, point),
});

// The role in use first, so a garage-side account learns to switch roles
// rather than meeting the capability policy's 404. Each method repeats the
// controller's guard, so a caller that is not the controller is refused too.
function driverOnly(actor: Actor) {
  if (actor.role !== 'driver') {
    throw refusal(
      HttpStatus.FORBIDDEN,
      'driver_role_required',
      'Switch to your driver role to save garages',
    );
  }
  requireCapability(actor, 'driver.saved_garages');
}

// The same check before the query or body is validated, so a garage-side
// account sending a bad place still meets the role refusal first.
@Injectable()
export class DriverOnly implements CanActivate {
  canActivate(context: ExecutionContext) {
    driverOnly(context.switchToHttp().getRequest<{ actor: Actor }>().actor);
    return true;
  }
}

// A driver's saved garages. Their audit entries are of subject type
// `saved_garage`, which the garage's own history does not read, so a garage
// never learns who saved it.
@Injectable()
export class SavedGaragesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async save(actor: Actor, garageId: string, savedAt?: string): Promise<Saved> {
    driverOnly(actor);
    const at = savedAt ? new Date(savedAt) : new Date();
    if (at.getTime() > Date.now()) {
      throw refusal(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'saved_at_in_future',
        'The time a garage was saved cannot be in the future',
      );
    }
    const key = { accountId: actor.accountId, garageId };
    const once = () =>
      this.create(actor, key, at).catch((error) => this.raced(error, key));
    // Null: a removal took the row another save had made. Once more only.
    return (await once()) ?? (await this.create(actor, key, at));
  }

  private create(actor: Actor, key: Key, at: Date): Promise<Saved> {
    return this.prisma.$transaction(async (tx) => {
      const kept = await tx.savedGarage.findUnique({
        where: { accountId_garageId: key },
      });
      if (kept) return { created: false, row: answer(kept) };
      const garage = await tx.garage.findFirst({
        select: { id: true },
        where: { id: key.garageId, ...publicGarages() },
      });
      if (!garage) {
        throw refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such garage');
      }
      const row = answer(
        await tx.savedGarage.create({ data: { ...key, savedAt: at } }),
      );
      await this.audit.record(tx, entry(actor, 'added', row));
      await this.events.record(tx, event(actor, 'added', row));
      return { created: true, row };
    });
  }

  // Two tabs saving at once: the first made the row, this one finds it.
  private async raced(error: unknown, key: Key): Promise<Saved | null> {
    if (!isUniqueViolation(error)) throw error;
    const kept = await this.prisma.savedGarage.findUnique({
      where: { accountId_garageId: key },
    });
    return kept ? { created: false, row: answer(kept) } : null;
  }

  // The removed row, whose time an undo sends back; null when none was saved.
  async remove(actor: Actor, garageId: string): Promise<SavedGarageDto | null> {
    driverOnly(actor);
    return this.prisma.$transaction(async (tx) => {
      const [gone] = await tx.$queryRaw<SavedGarage[]>`
        DELETE FROM saved_garage
        WHERE account_id = ${actor.accountId}::uuid AND garage_id = ${garageId}::uuid
        RETURNING account_id AS "accountId", garage_id AS "garageId", saved_at AS "savedAt"`;
      if (!gone) return null;
      const row = answer(gone);
      await this.audit.record(tx, entry(actor, 'removed', row));
      await this.events.record(tx, event(actor, 'removed', row));
      return row;
    });
  }

  // Every saved garage whatever its status, newest saved first; the counts
  // are over the whole list, not the page.
  async list(
    actor: Actor,
    query: SavedGaragesQueryDto,
  ): Promise<SavedGaragesPageDto> {
    driverOnly(actor);
    const after =
      query.cursor === undefined ? undefined : readCursor(query.cursor);
    const point = parseNear(query.near);
    const me = actor.accountId;
    const distance = point
      ? Prisma.sql`CASE WHEN garage.latitude IS NULL THEN NULL ELSE ${distanceMetersSql(point)} END`
      : Prisma.sql`NULL::float8`;
    const from = after
      ? Prisma.sql`AND (saved_garage.saved_at, saved_garage.garage_id) < (${after.at}::timestamptz, ${after.id}::uuid)`
      : Prisma.empty;
    const [rows, [counts]] = await Promise.all([
      this.prisma.$queryRaw<ListRow[]>`
        SELECT
          garage.id AS garage_id,
          garage.name,
          garage.slug,
          garage.rating::float8 AS rating,
          garage.review_count,
          garage.status = 'approved' AS available,
          garage.business_kind::text AS business_kind,
          garage.business_kind IS NOT DISTINCT FROM 'mobile' AS mobile,
          COALESCE(garage.service_radius_km, ${MOBILE_SERVICE_RADIUS_DEFAULT_KM})::int AS radius_km,
          saved_garage.saved_at,
          ${distance} AS distance_m,
          COALESCE((
            SELECT json_agg(json_build_object('id', brand.id, 'name', brand.name)
              ORDER BY w.created_at DESC, w.car_id DESC)
            FROM (
              SELECT DISTINCT ON (car.brand_id)
                car.brand_id, car.created_at, car.id AS car_id
              ${workingCars(me)}
              ORDER BY car.brand_id, car.created_at DESC, car.id DESC
            ) w
            JOIN brand ON brand.id = w.brand_id
          ), '[]'::json) AS brands
        FROM saved_garage
        JOIN garage ON garage.id = saved_garage.garage_id
        WHERE saved_garage.account_id = ${me}::uuid ${from}
        ORDER BY saved_garage.saved_at DESC, saved_garage.garage_id DESC
        LIMIT ${PAGE + 1}`,
      this.prisma.$queryRaw<{ total: number; working: number }[]>`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE EXISTS (SELECT 1 ${workingCars(me)}))::int AS working
        FROM saved_garage
        JOIN garage ON garage.id = saved_garage.garage_id
        WHERE saved_garage.account_id = ${me}::uuid`,
    ]);
    const page = rows.slice(0, PAGE);
    const last = page.at(-1);
    return {
      items: page.map((row) => itemOf(row, point)),
      nextCursor:
        rows.length > PAGE && last
          ? cursorOf({ garageId: last.garage_id, savedAt: last.saved_at })
          : null,
      total: counts.total,
      workingCount: counts.working,
    };
  }

  async ids(actor: Actor): Promise<SavedGarageIdsDto> {
    driverOnly(actor);
    const rows = await this.prisma.savedGarage.findMany({
      select: { garageId: true },
      where: { accountId: actor.accountId },
    });
    return { ids: rows.map((row) => row.garageId) };
  }
}
