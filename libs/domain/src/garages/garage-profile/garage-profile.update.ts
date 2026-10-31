import {
  type GarageProfileDto,
  isRecord,
  normalisePhone,
  UpdateGarageProfileDto,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { type ValidationError, validateSync } from 'class-validator';

import { GarageProfileService } from './garage-profile.service';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { canonical } from '../../audit/audit.service';
import { refusal } from '../../auth/http-refusal';
import type { Actor } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { localDay } from '../../bucharest';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import {
  assertGarageOwner,
  noGarage,
} from '../garage-brands/garage-brands.service';
import { writeGarageHours } from '../garage-hours';
import { requireListedCourtesyCar } from '../garage-settings/courtesy-car-guard';

// Changed only through the warned flow of a new verification.
const VERIFIED = [
  'address',
  'companyName',
  'cui',
  'mobileLegalForm',
  'seatAddress',
  'rarActivities',
  'proposedJobs',
] as const;
const GROUPS = [
  'name',
  'description',
  'phone',
  'hours',
  'closedDays',
  'serviceRadiusKm',
  'facilities',
] as const;

type ClosedDays = { day: string; note: string | null }[];
type HoursState = { hours: unknown; closed_days: ClosedDays };

// The columns as the history names them.
type Texts = {
  name: string;
  known_for: string | null;
  phone: string | null;
  service_radius_km: number | null;
};

type Terms = {
  payment_cash: boolean;
  payment_card: boolean;
  payment_transfer: boolean;
  courtesy_car_paid: boolean;
  courtesy_car_price_per_day_bani: number | null;
};
type Columns = Texts & Terms;

type Locked = Columns &
  HoursState & {
    status: string;
    business_kind: string | null;
    profile_version: number;
    facilities: string[];
    facilities_note: string | null;
  };

const COLUMNS: Record<
  keyof Columns,
  keyof Prisma.GarageUpdateManyMutationInput
> = {
  courtesy_car_paid: 'courtesyCarPaid',
  courtesy_car_price_per_day_bani: 'courtesyCarPricePerDayBani',
  known_for: 'knownFor',
  name: 'name',
  payment_card: 'paymentCard',
  payment_cash: 'paymentCash',
  payment_transfer: 'paymentTransfer',
  phone: 'phone',
  service_radius_km: 'serviceRadiusKm',
};
// The event names a column's group, the payments and the courtesy car as one.
const fieldOf = (column: keyof Columns) =>
  column.startsWith('payment_')
    ? 'payment_methods'
    : column.startsWith('courtesy_car_')
      ? 'courtesy_car'
      : column;
// A change of these moves the garage in search results.
const SEARCHED = new Set([
  'name',
  'hours',
  'closed_days',
  'service_radius_km',
  'facilities',
  'payment_methods',
]);

const invalid = (errors: { code: string; field: string }[], message: string) =>
  refusal(HttpStatus.BAD_REQUEST, 'validation_failed', message, errors);

const changed = () =>
  refusal(
    HttpStatus.CONFLICT,
    'profile_changed',
    'The profile changed since it was read',
  );

// The row locked, so two saves of one garage run one after the other, with
// everything the hours write is handed back unchanged.
async function lockGarage(
  tx: Prisma.TransactionClient,
  garageId: string,
): Promise<Locked> {
  const [row] = await tx.$queryRaw<Locked[]>`
    SELECT g.status::text AS status, g.business_kind::text AS business_kind,
      g.profile_version, g.name, g.known_for, g.phone, g.service_radius_km,
      g.hours, g.facilities_note, g.payment_cash, g.payment_card,
      g.payment_transfer, g.courtesy_car_paid,
      g.courtesy_car_price_per_day_bani,
      ARRAY(SELECT f.facility::text FROM garage_facility f
        WHERE f.garage_id = g.id ORDER BY 1) AS facilities,
      COALESCE((SELECT json_agg(json_build_object(
          'day', to_char(c.day, 'YYYY-MM-DD'), 'note', c.note) ORDER BY c.day)
        FROM garage_closed_day c WHERE c.garage_id = g.id), '[]') AS closed_days
    FROM garage g WHERE g.id = ${garageId}::uuid FOR UPDATE OF g`;
  if (!row) throw noGarage();
  return row;
}

// The week and closed days as the hours write left them.
async function hoursOf(
  tx: Prisma.TransactionClient,
  garageId: string,
): Promise<HoursState> {
  const [row] = await tx.$queryRaw<HoursState[]>`
    SELECT g.hours, COALESCE((SELECT json_agg(json_build_object(
        'day', to_char(c.day, 'YYYY-MM-DD'), 'note', c.note) ORDER BY c.day)
      FROM garage_closed_day c WHERE c.garage_id = g.id), '[]') AS closed_days
    FROM garage g WHERE g.id = ${garageId}::uuid`;
  return row;
}

// A garage drivers cannot see is not edited: gone when suspended, unknown
// until approved.
function assertListed(row: Locked) {
  if (row.status === 'suspended') {
    throw refusal(HttpStatus.GONE, 'gone', 'This garage is no longer listed');
  }
  if (row.status !== 'approved') throw noGarage();
}

function assertNotVerified(body: unknown) {
  if (!isRecord(body)) return;
  const sent = VERIFIED.filter((field) => Object.hasOwn(body, field));
  if (sent.length === 0) return;
  throw refusal(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'needs_verification',
    'These fields change only through a new verification',
    sent.map((field) => ({ code: 'needs_verification', field })),
  );
}

// The body's limits, judged as the API's pipe would, plus what only the row
// knows: a radius is a mobile mechanic's.
function validBody(body: unknown, row: Locked): UpdateGarageProfileDto {
  if (!isRecord(body)) throw invalid([], 'Send the profile as an object');
  const dto = plainToInstance(UpdateGarageProfileDto, body);
  const errors = broken(
    validateSync(dto, { forbidNonWhitelisted: true, whitelist: true }),
  );
  if (errors.length > 0) throw invalid(errors, 'The profile breaks a rule');
  if (!GROUPS.some((field) => body[field] !== undefined)) {
    throw invalid([], 'Nothing to save');
  }
  if (dto.facilities) {
    const { courtesyCar, facilities } = dto.facilities;
    requireListedCourtesyCar(courtesyCar, facilities.includes('courtesy_car'), {
      required: true,
    });
  }
  if (dto.serviceRadiusKm !== undefined && row.business_kind !== 'mobile') {
    throw invalid(
      [{ code: 'radius_not_applicable', field: 'serviceRadiusKm' }],
      'Only a mobile mechanic has a service radius',
    );
  }
  return dto;
}

// Each broken field by its path, a field inside the facilities group too.
function broken(
  errors: ValidationError[],
  parent = '',
): { code: string; field: string }[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    return e.children?.length && !e.constraints
      ? broken(e.children, field)
      : [{ code: Object.keys(e.constraints ?? {})[0] ?? 'invalid', field }];
  });
}

// The payment and courtesy-car columns as the save leaves them. Terms for an
// unticked courtesy car are not sent, so the stored ones stay.
function appliedTerms(row: Locked, dto: UpdateGarageProfileDto): Terms {
  const group = dto.facilities;
  const car = group?.courtesyCar;
  const payments = group?.paymentMethods;
  return {
    courtesy_car_paid: car ? car.paid : row.courtesy_car_paid,
    courtesy_car_price_per_day_bani: car
      ? (car.pricePerDayBani ?? null)
      : row.courtesy_car_price_per_day_bani,
    payment_card: payments ? payments.card : row.payment_card,
    payment_cash: payments ? payments.cash : row.payment_cash,
    payment_transfer: payments ? payments.transfer : row.payment_transfer,
  };
}

// The columns as the save leaves them.
function applied(row: Locked, dto: UpdateGarageProfileDto): Columns {
  const description = dto.description?.trim();
  return {
    ...appliedTerms(row, dto),
    known_for: description === undefined ? row.known_for : description || null,
    name: dto.name?.trim() ?? row.name,
    phone: dto.phone === undefined ? row.phone : normalisePhone(dto.phone),
    service_radius_km: dto.serviceRadiusKm ?? row.service_radius_km,
  };
}

// Which of the facility set and the trimmed note differ from the stored ones.
function movedFacilities(row: Locked, dto: UpdateGarageProfileDto): string[] {
  const group = dto.facilities;
  if (!group) return [];
  const set = (list: string[]) => canonical([...list].sort());
  return [
    ...(set(group.facilities) === set(row.facilities) ? [] : ['facilities']),
    ...((group.facilitiesNote?.trim() || null) === row.facilities_note
      ? []
      : ['facilities_note']),
  ];
}

const sortedDays = (days: { day: string; note?: string | null }[]) =>
  days
    .map((c) => ({ day: c.day, note: c.note?.trim() || null }))
    .sort((a, b) => a.day.localeCompare(b.day));

@Injectable()
export class GarageProfileUpdate {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    private readonly profile: GarageProfileService,
  ) {}

  // The owner's name, description, phone, hours with closed days, radius and
  // facilities with their terms, in place and with no review. Refused in
  // order: who asks, the garage's state, the verified fields, the limits,
  // then a stale stamp.
  async save(
    actor: Actor,
    garageId: string,
    body: unknown,
  ): Promise<GarageProfileDto> {
    assertGarageOwner(actor, garageId);
    await this.prisma.$transaction(async (tx) => {
      const row = await lockGarage(tx, garageId);
      assertListed(row);
      assertNotVerified(body);
      const dto = validBody(body, row);
      if (dto.version !== String(row.profile_version)) throw changed();
      await this.persist(tx, actor, garageId, row, dto);
    });
    return this.profile.answer(garageId, true);
  }

  private async persist(
    tx: Prisma.TransactionClient,
    actor: Actor,
    garageId: string,
    row: Locked,
    dto: UpdateGarageProfileDto,
  ) {
    const hours = await this.writeHours(tx, actor, garageId, row, dto);
    const after = applied(row, dto);
    const moved = (Object.keys(COLUMNS) as (keyof Columns)[]).filter(
      (field) => canonical(row[field]) !== canonical(after[field]),
    );
    const fields = [...new Set([...moved.map(fieldOf), ...hours])].sort(
      (a, b) => FIELD_ORDER.indexOf(a) - FIELD_ORDER.indexOf(b),
    );
    if (fields.length === 0) return;
    const { count } = await tx.garage.updateMany({
      data: {
        ...Object.fromEntries(moved.map((f) => [COLUMNS[f], after[f]])),
        profileVersion: { increment: 1 },
      },
      where: { id: garageId, profileVersion: row.profile_version },
    });
    if (count === 0) throw changed();
    if (moved.length > 0) {
      await this.audit.recordChanges(
        tx,
        {
          actorId: actor.accountId,
          actorRole: actor.role,
          garageId,
          subjectId: garageId,
          subjectType: 'garage',
        },
        Object.fromEntries(moved.map((f) => [f, row[f]])),
        Object.fromEntries(moved.map((f) => [f, after[f]])),
      );
    }
    // The phone is named, never carried.
    await this.events.record(tx, {
      audience: {
        garageId,
        results: fields.some((f) => SEARCHED.has(f)),
        type: 'public_garage',
      },
      kind: 'garage.updated',
      payload: { fields, garageId },
      subjectId: garageId,
    });
  }

  // The listing's one hours write, handed the garage's week, closed days,
  // facilities and note as sent or as stored, and its payments and courtesy
  // car as they are so it leaves them; it records its own history. Answers
  // which of the week, the closed days, the facilities and the note changed.
  private async writeHours(
    tx: Prisma.TransactionClient,
    actor: Actor,
    garageId: string,
    row: Locked,
    dto: UpdateGarageProfileDto,
  ): Promise<string[]> {
    const facilities = movedFacilities(row, dto);
    const hoursSent = dto.hours !== undefined || dto.closedDays !== undefined;
    if (!hoursSent && facilities.length === 0) return [];
    const before = { closed_days: row.closed_days, hours: row.hours };
    const sent = {
      closed_days:
        dto.closedDays ??
        row.closed_days.map(({ day, note }) => ({
          day,
          ...(note !== null && { note }),
        })),
      hours: dto.hours ?? row.hours,
    };
    if (movedHours(before, sent).length === 0 && facilities.length === 0) {
      return [];
    }
    const group = dto.facilities;
    await writeGarageHours(
      tx,
      garageId,
      {
        ...keptSection(row),
        ...(group && {
          facilities: group.facilities,
          facilitiesNote: group.facilitiesNote?.trim() || undefined,
        }),
        closedDays: sent.closed_days,
        hours: sent.hours,
      },
      localDay(new Date()),
      { actorId: actor.accountId, audit: this.audit, events: this.events },
    );
    return [...movedHours(before, await hoursOf(tx, garageId)), ...facilities];
  }
}

// Which of the week and the closed days differ, a closed day's note trimmed.
function movedHours(
  before: HoursState,
  after: {
    hours: unknown;
    closed_days: { day: string; note?: string | null }[];
  },
): string[] {
  const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
  return [
    ...(same(before.hours, after.hours) ? [] : ['hours']),
    ...(same(sortedDays(before.closed_days), sortedDays(after.closed_days))
      ? []
      : ['closed_days']),
  ];
}

// The rest of the hours section as the garage keeps it today.
function keptSection(row: Locked) {
  const price = row.courtesy_car_price_per_day_bani;
  const courtesyCar = {
    paid: row.courtesy_car_paid,
    ...(price !== null && { pricePerDayBani: price }),
  };
  const payments = [
    ['cash', row.payment_cash],
    ['card', row.payment_card],
    ['transfer', row.payment_transfer],
  ] as const;
  return {
    ...(row.facilities.includes('courtesy_car') && { courtesyCar }),
    facilities: row.facilities,
    ...(row.facilities_note !== null && {
      facilitiesNote: row.facilities_note,
    }),
    payments: payments.filter(([, ticked]) => ticked).map(([name]) => name),
  };
}

const FIELD_ORDER: string[] = [
  'name',
  'known_for',
  'phone',
  'hours',
  'closed_days',
  'service_radius_km',
  'facilities',
  'facilities_note',
  'courtesy_car',
  'payment_methods',
];
