import type {
  CarDto,
  CarListDto,
  CreateCarDto,
  UpdateCarDto,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../../audit/audit.port';
import { AccountsService } from '../../../auth/accounts.service';
import { type Actor, requireCapability } from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import { refusal } from '../../../auth/sign-up.service';
import { localDay } from '../../../bucharest';
import { EVENT_PORT, type EventPort } from '../../../events/event.port';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client';

const LIMIT = 20;
// A request in one of these is still under way, so its car stays.
const OPEN_REQUEST = ['sent', 'quoted', 'booked', 'in_work'] as const;
const DATES = ['itpUntil', 'rcaUntil', 'rovinietaUntil'] as const;

const withBrand = { brand: { select: { name: true } } } as const;
type CarRow = Prisma.CarGetPayload<{ include: typeof withBrand }>;

const day = (at: Date | null) => at?.toISOString().slice(0, 10) ?? null;
const date = (value: string | null | undefined) =>
  value ? new Date(`${value}T00:00:00Z`) : null;

function answer(car: CarRow): CarDto {
  return {
    brandId: car.brandId,
    brandName: car.brand.name,
    createdAt: car.createdAt.toISOString(),
    engine: car.engine,
    fuel: car.fuel,
    id: car.id,
    itpUntil: day(car.itpUntil),
    model: car.model,
    odometerKm: car.odometerKm,
    plate: car.plate,
    rcaUntil: day(car.rcaUntil),
    rovinietaUntil: day(car.rovinietaUntil),
    updatedAt: car.updatedAt.toISOString(),
    year: car.year,
  };
}

// The fields an edit may change, as the car answer shows them.
const EDITABLE = [
  'brandId',
  'model',
  'year',
  'odometerKm',
  'fuel',
  'engine',
  'plate',
  ...DATES,
] as const;
type Editable = (typeof EDITABLE)[number];

const invalid = (field: string, code: string, message: string) =>
  refusal(HttpStatus.BAD_REQUEST, 'validation_failed', message, [
    { code, field },
  ]);

// Five years from today in Bucharest, the same day of the month.
function assertNotTooFar(
  dto: Partial<Record<(typeof DATES)[number], string | null>>,
) {
  const today = localDay(new Date());
  const latest = `${Number(today.slice(0, 4)) + 5}${today.slice(4)}`;
  const field = DATES.find((f) => (dto[f] ?? '') > latest);
  if (field) {
    throw invalid(
      field,
      'too_far_ahead',
      'A date is more than five years ahead',
    );
  }
}

type Changes = Partial<Pick<UpdateCarDto, Editable>>;

// The caller's own car, not removed, locked until the transaction ends.
async function ownCar(
  tx: Prisma.TransactionClient,
  id: string,
  ownerId: string,
): Promise<CarRow> {
  await tx.$queryRaw`SELECT id FROM car WHERE id = ${id}::uuid FOR UPDATE`;
  const car = await tx.car.findFirst({
    include: withBrand,
    where: { id, ownerId, removedAt: null },
  });
  if (!car) throw refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such car');
  return car;
}

// The caller's own car, locked, at the version the edit was read from.
async function lockedCar(
  tx: Prisma.TransactionClient,
  id: string,
  ownerId: string,
  version: string,
): Promise<CarRow> {
  const car = await ownCar(tx, id, ownerId);
  if (car.updatedAt.getTime() !== new Date(version).getTime()) {
    throw refusal(
      HttpStatus.CONFLICT,
      'stale_version',
      'The car was changed since this version',
    );
  }
  return car;
}

// The sent fields that differ from the car, after the add dialog's
// normalisation: an empty engine is the missing one.
function changes(dto: UpdateCarDto, before: CarDto): Changes {
  const sent = dto.engine === '' ? { ...dto, engine: null } : dto;
  const after: Changes = {};
  const take = <K extends Editable>(field: K) => {
    const value = sent[field];
    if (value !== undefined && !Object.is(value, before[field])) {
      after[field] = value;
    }
  };
  for (const field of EDITABLE) take(field);
  return after;
}

async function activeBrand(tx: Prisma.TransactionClient, brandId: string) {
  const brand = await tx.brand.findFirst({
    where: { active: true, id: brandId },
  });
  if (!brand) {
    throw invalid('brandId', 'unknown_brand', 'No such brand in the catalogue');
  }
}

function carData(
  after: Changes,
  version: Date,
): Prisma.CarUncheckedUpdateInput {
  const data: Prisma.CarUncheckedUpdateInput = {
    ...after,
    // A version later than the one read, even within one millisecond.
    updatedAt: new Date(Math.max(Date.now(), version.getTime() + 1)),
  };
  for (const field of DATES) {
    if (field in after) data[field] = date(after[field] ?? null);
  }
  return data;
}

const editEntry = (actor: Actor, carId: string) => ({
  actorId: actor.accountId,
  actorRole: actor.role,
  carId,
  subjectId: carId,
  subjectType: 'car',
});

// A garage account that is not a driver yet becomes one with its first car.
const joinsAsDriver = (actor: Actor) =>
  actor.role === 'garage' && !actor.roles.includes('driver');

@Injectable()
export class CarsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    private readonly accounts: AccountsService,
  ) {}

  // The account row is locked first, so two saves from one account (the
  // same key twice, or the 20th car twice) run one after the other.
  async create(actor: Actor, key: string, dto: CreateCarDto): Promise<CarDto> {
    const joins = joinsAsDriver(actor);
    if (!joins) requireCapability(actor, 'driver.cars');
    assertNotTooFar(dto);
    const ownerId = actor.accountId;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM account WHERE id = ${ownerId}::uuid FOR UPDATE`;
      const saved = await tx.car.findUnique({
        include: withBrand,
        where: { ownerId_idempotencyKey: { idempotencyKey: key, ownerId } },
      });
      if (saved) return answer(saved);
      const brand = await tx.brand.findFirst({
        where: { active: true, id: dto.brandId },
      });
      if (!brand) {
        throw invalid(
          'brandId',
          'unknown_brand',
          'No such brand in the catalogue',
        );
      }
      const held = await tx.car.count({ where: { ownerId, removedAt: null } });
      if (held >= LIMIT) {
        throw refusal(
          HttpStatus.CONFLICT,
          'car_limit',
          `An account holds at most ${LIMIT} cars`,
        );
      }
      const car = await tx.car.create({
        data: {
          brandId: brand.id,
          engine: dto.engine || null,
          fuel: dto.fuel,
          idempotencyKey: key,
          itpUntil: date(dto.itpUntil),
          model: dto.model,
          odometerKm: dto.odometerKm,
          ownerId,
          plate: dto.plate ?? null,
          rcaUntil: date(dto.rcaUntil),
          rovinietaUntil: date(dto.rovinietaUntil),
          year: dto.year,
        },
        include: withBrand,
      });
      if (joins) {
        await this.accounts.grantRole(
          tx,
          { id: ownerId, role: actor.role },
          ownerId,
          'driver',
        );
      }
      const shown = answer(car);
      const facts = {
        brandId: car.brandId,
        fuel: car.fuel,
        itpUntil: shown.itpUntil,
        odometerKm: car.odometerKm,
        rcaUntil: shown.rcaUntil,
        rovinietaUntil: shown.rovinietaUntil,
        year: car.year,
      };
      // No plate: admins read the audit history, and the plate is the owner's alone.
      await this.audit.record(tx, {
        action: 'create',
        actorId: ownerId,
        actorRole: actor.role,
        carId: car.id,
        newValue: { ...facts, engine: car.engine, model: car.model },
        subjectId: car.id,
        subjectType: 'car',
      });
      // No plate and no model: the outbox is read beyond the owner.
      await this.events.record(tx, {
        audience: { ownerAccountId: ownerId, type: 'car' },
        kind: 'car.added',
        payload: { ...facts, carId: car.id, ownerId },
        subjectId: car.id,
      });
      return shown;
    });
  }

  // A merge patch on the version the person read: an older version is
  // refused, an edit that changes nothing writes nothing. The car row is
  // locked first, so of two edits on one version only one goes through.
  async update(actor: Actor, id: string, dto: UpdateCarDto): Promise<CarDto> {
    requireCapability(actor, 'driver.cars');
    assertNotTooFar(dto);
    return this.prisma.$transaction(async (tx) => {
      const car = await lockedCar(tx, id, actor.accountId, dto.version);
      const before = answer(car);
      const after = changes(dto, before);
      const changed = Object.keys(after) as Editable[];
      if (changed.length === 0) return before;
      if (after.brandId !== undefined) await activeBrand(tx, after.brandId);
      const saved = answer(
        await tx.car.update({
          data: carData(after, car.updatedAt),
          include: withBrand,
          where: { id },
        }),
      );
      // One entry per changed field. The plate is the owner's alone: its
      // entry says it changed, not to what.
      const { plate, ...rest } = after;
      const entry = editEntry(actor, id);
      await this.audit.recordChanges(tx, entry, { ...before }, rest);
      if (plate !== undefined) {
        await this.audit.record(tx, {
          ...entry,
          action: 'update',
          field: 'plate',
          newValue: null,
          oldValue: null,
        });
      }
      // No plate and no model: the outbox is read beyond the owner.
      await this.events.record(tx, {
        audience: { ownerAccountId: actor.accountId, type: 'car' },
        kind: 'car.updated',
        payload: {
          carId: id,
          changed,
          ownerId: actor.accountId,
        },
        subjectId: id,
      });
      return saved;
    });
  }

  // A soft removal: the row stays, with its requests and repairs, and
  // leaves every list. Refused while a request for the car is under way.
  async remove(actor: Actor, id: string): Promise<void> {
    requireCapability(actor, 'driver.cars');
    const ownerId = actor.accountId;
    await this.prisma.$transaction(async (tx) => {
      // A request is sent under the owner's account lock: taking it first
      // means one sent meanwhile is counted below, not missed.
      await tx.$queryRaw`SELECT id FROM account WHERE id = ${ownerId}::uuid FOR UPDATE`;
      await ownCar(tx, id, ownerId);
      const open = await tx.quoteRequest.count({
        where: { carId: id, status: { in: [...OPEN_REQUEST] } },
      });
      if (open > 0) {
        throw refusal(
          HttpStatus.CONFLICT,
          'open_request',
          'The car has a request under way',
        );
      }
      await tx.car.update({ data: { removedAt: new Date() }, where: { id } });
      await this.audit.record(tx, {
        ...editEntry(actor, id),
        action: 'delete',
        text: 'car removed',
      });
      // No plate and no model: the outbox is read beyond the owner.
      await this.events.record(tx, {
        audience: { ownerAccountId: ownerId, type: 'car' },
        kind: 'car.removed',
        payload: { carId: id, ownerId },
        subjectId: id,
      });
    });
  }

  async list(actor: Actor): Promise<CarListDto> {
    const rows = await this.prisma.car.findMany({
      include: withBrand,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: { ownerId: actor.accountId, removedAt: null },
    });
    return { items: rows.map(answer) };
  }
}
