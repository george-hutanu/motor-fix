import type { CarRepairDto, LogRepairDto } from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import { type LoggedCheck, recordLogged } from './log-repair.metrics';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { notFound, refusal } from '../../auth/http-refusal';
import type { Actor } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { localDay } from '../../bucharest';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import { publicGarages } from '../../garages/public-garages/public-garages';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import {
  type OwnershipRow,
  REPAIR_ROW_SELECT,
  repairWhere,
  toRow,
} from '../history/history';

const FUTURE_DATE = 'Data e în viitor. Verifică, te rog.';
const km = new Intl.NumberFormat('ro-RO');
const belowEarlier = (earlierKm: number) =>
  `Kilometrajul e mai mic decât o citire mai veche (${km.format(earlierKm)} km). Verifică, te rog.`;

@Injectable()
export class LogRepairService {
  private readonly logger = new Logger('LogRepair');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  // Every refusal reads before anything is written, in the transaction that
  // writes the row, its audit entry and its event, so a car removed meanwhile
  // answers the same 404.
  async log(
    actor: Actor,
    carId: string,
    dto: LogRepairDto,
  ): Promise<CarRepairDto> {
    const { accountId } = actor;
    const answer = await this.prisma.$transaction(async (tx) => {
      const row = await tx.carOwnership.findFirst({
        include: { car: { select: { year: true } } },
        where: {
          accountId,
          car: { ownerId: accountId, removedAt: null },
          carId,
          toDate: null,
        },
      });
      if (!row) throw notFound('Nu există această mașină');
      const garage = await this.garage(tx, dto);
      if (dto.doneOn < `${row.car.year}-01-01`) {
        recordLogged('date_before_car_year');
        throw refusal(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'date_before_car_year',
          'Data e înainte de anul mașinii',
        );
      }
      const doneOn = new Date(`${dto.doneOn}T00:00:00Z`);
      if (dto.confirm !== true) await this.check(tx, row, dto, doneOn);

      const created = await tx.repair.create({
        data: {
          carId,
          costBani: dto.costBani ?? null,
          doneOn,
          garageId: garage.id,
          garageName: garage.name,
          loggedBy: accountId,
          odometerKm: dto.odometerKm,
          source: 'logged',
          updatedBy: accountId,
          updatedByRole: 'driver',
          what: dto.what,
        },
        select: REPAIR_ROW_SELECT,
      });
      await this.audit.record(tx, {
        action: 'create',
        actorId: accountId,
        actorRole: actor.role,
        assistantGrantId: actor.assistantGrantId,
        carId,
        ...(garage.id && { garageId: garage.id }),
        newValue: {
          costBani: created.costBani,
          doneOn: dto.doneOn,
          garageId: garage.id,
          garageName: garage.name,
          odometerKm: dto.odometerKm,
          source: 'logged',
          what: dto.what,
        },
        requestId: actor.requestId,
        subjectId: created.id,
        subjectType: 'repair',
      });
      // The caller holds the open row, so they are the owner told.
      await this.events.record(tx, {
        audience: {
          ownerAccountId: accountId,
          sharedGarageId: null,
          type: 'repair',
        },
        kind: 'repair.logged',
        payload: {
          carId,
          garageId: garage.id,
          ownerId: accountId,
          repairId: created.id,
        },
        subjectId: created.id,
      });
      return { created, row };
    });
    const { created, row } = answer;
    this.logger.log(
      `repair ${created.id} logged on car ${carId}${created.garageId ? ` at garage ${created.garageId}` : ''}`,
    );
    recordLogged('saved');
    return toRow(created, row, actor.language ?? 'ro');
  }

  // A garage from the list names the repair by its own name; one not
  // approved is refused alike, so nothing about it is learnt.
  private async garage(tx: Prisma.TransactionClient, dto: LogRepairDto) {
    if (dto.garageId === undefined) {
      return { id: null, name: dto.garageName as string };
    }
    const garage = await tx.garage.findFirst({
      select: { id: true, name: true },
      where: { ...publicGarages(), id: dto.garageId },
    });
    if (!garage) {
      recordLogged('unknown_garage');
      throw refusal(
        HttpStatus.BAD_REQUEST,
        'validation_failed',
        'Service-ul nu e pe MotorFix',
        [{ code: 'unknown_garage', field: 'garageId' }],
      );
    }
    return garage;
  }

  // The two values a driver confirms rather than corrects: a day after today
  // in Bucharest, and a reading below the highest one the caller may see on
  // or before that day.
  private async check(
    tx: Prisma.TransactionClient,
    row: OwnershipRow,
    dto: LogRepairDto,
    doneOn: Date,
  ) {
    const future = dto.doneOn > localDay(new Date());
    const repairs = await tx.repair.aggregate({
      _max: { odometerKm: true },
      where: { ...repairWhere(row), doneOn: { lte: doneOn } },
    });
    const readings = await tx.odometerReading.aggregate({
      _max: { km: true },
      where: { carId: row.carId, readOn: { lte: doneOn } },
    });
    const earlier = [repairs._max.odometerKm, readings._max.km].filter(
      (value): value is number => value !== null,
    );
    const earlierKm = Math.max(...earlier);
    // With no earlier reading the maximum is -Infinity: nothing is below it.
    const below = dto.odometerKm < earlierKm;
    if (!future && !below) return;

    const check: LoggedCheck =
      future && below
        ? 'both'
        : future
          ? 'future_date'
          : 'odometer_below_earlier';
    recordLogged('check_needed', check);
    throw new HttpException(
      {
        code: 'check_needed',
        errors: [
          ...(future ? [{ code: 'future_date', field: 'doneOn' }] : []),
          ...(below
            ? [{ code: 'odometer_below_earlier', field: 'odometerKm' }]
            : []),
        ],
        message: future ? FUTURE_DATE : belowEarlier(earlierKm),
        ...(below && { earlierKm }),
      },
      HttpStatus.CONFLICT,
    );
  }
}
