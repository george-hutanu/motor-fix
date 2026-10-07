import type { CarDto, CarListDto, CreateCarDto } from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import { AccountsService } from '../auth/accounts.service';
import { type Actor, requireCapability } from '../auth/policy';
import { PRISMA } from '../auth/prisma';
import { refusal } from '../auth/sign-up.service';
import { localDay } from '../bucharest';
import { EVENT_PORT, type EventPort } from '../events/event.port';
import type { Prisma, PrismaClient } from '../generated/prisma/client';

const LIMIT = 20;
const DATES = ['itpUntil', 'rcaUntil', 'rovinietaUntil'] as const;

const withBrand = { brand: { select: { name: true } } } as const;
type CarRow = Prisma.CarGetPayload<{ include: typeof withBrand }>;

const day = (at: Date | null) => at?.toISOString().slice(0, 10) ?? null;
const date = (value: string | undefined) =>
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
    year: car.year,
  };
}

const invalid = (field: string, code: string, message: string) =>
  refusal(HttpStatus.BAD_REQUEST, 'validation_failed', message, [
    { code, field },
  ]);

// Five years from today in Bucharest, the same day of the month.
function assertNotTooFar(dto: CreateCarDto) {
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

  async list(actor: Actor): Promise<CarListDto> {
    const rows = await this.prisma.car.findMany({
      include: withBrand,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: { ownerId: actor.accountId, removedAt: null },
    });
    return { items: rows.map(answer) };
  }
}
