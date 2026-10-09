import {
  type CandidateGarageListDto,
  type CandidateGaragesQueryDto,
  type CannotReceiveReason,
  type CreateQuoteRequestDto,
  type GarageCannotReceiveProblem,
  parseNear,
  REQUEST_DESCRIPTION_MIN_WITHOUT_JOBS,
  type RequestDto,
} from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { recordSend, type SendOutcome } from './quote-requests.metrics';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import { addLocalDays, atLocal, localDay } from '../../bucharest';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type {
  Car,
  Fuel,
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client';
import { garagesInArea } from '../../search/area/search-area';
import {
  REQUEST_DAILY_LIMIT,
  REQUEST_MAX_GARAGES,
  REQUEST_VALIDITY_DAYS,
} from '../quotes-config';
import { RequestsService } from '../requests/requests.service';

type Db = PrismaClient | Prisma.TransactionClient;

const invalid = (field: string, code: string, message: string) =>
  refusal(HttpStatus.BAD_REQUEST, 'validation_failed', message, [
    { code, field },
  ]);

// An id no garage holds reads as a garage not taking requests, with no name,
// so the answer never tells an existing garage from a missing one.
function cannotReceive(
  garageId: string,
  garageName: string,
  reason: CannotReceiveReason,
) {
  const body: Omit<GarageCannotReceiveProblem, 'status'> & { message: string } =
    {
      code: 'garage_cannot_receive',
      garageId,
      garageName,
      message: 'A garage of the request cannot receive it',
      reason,
    };
  return new HttpException(body, HttpStatus.BAD_REQUEST);
}

// What the body must hold beyond its own field rules.
function assertShape(dto: CreateQuoteRequestDto) {
  if (dto.garageIds.length > REQUEST_MAX_GARAGES) {
    throw invalid(
      'garageIds',
      'too_many',
      `A request goes to at most ${REQUEST_MAX_GARAGES} garages`,
    );
  }
  if (dto.sources.length !== dto.garageIds.length) {
    throw invalid(
      'sources',
      'length_mismatch',
      'Each garage needs its source, one for one',
    );
  }
  if (dto.jobTypeIds.length > 0) return;
  if (!dto.description) {
    throw invalid(
      'description',
      'required',
      'A request with no job says what is wrong',
    );
  }
  if (dto.description.length < REQUEST_DESCRIPTION_MIN_WITHOUT_JOBS) {
    throw invalid(
      'description',
      'too_short',
      `A request with no job says it in at least ${REQUEST_DESCRIPTION_MIN_WITHOUT_JOBS} characters`,
    );
  }
}

// The garages that take the car and, when there are jobs, one of them: the
// brand row says works_on, ticks the fuel and ticks a job for the brand.
const takes = (car: Pick<Car, 'brandId' | 'fuel'>, jobTypeIds: string[]) => ({
  brands: {
    some: {
      brandId: car.brandId,
      [car.fuel]: true,
      stance: 'works_on' as const,
      ...(jobTypeIds.length > 0 && {
        jobs: { some: { jobTypeId: { in: jobTypeIds } } },
      }),
    },
  },
  status: 'approved' as const,
});

// The first garage, in the order sent, that cannot take the request.
async function assertRouted(
  db: Db,
  car: Pick<Car, 'brandId' | 'fuel'>,
  garageIds: string[],
  jobTypeIds: string[],
) {
  const garages = await db.garage.findMany({
    select: {
      brands: {
        select: {
          diesel: true,
          electric: true,
          hybrid: true,
          jobs: {
            select: { jobTypeId: true },
            where: { jobTypeId: { in: jobTypeIds } },
          },
          petrol: true,
          stance: true,
        },
        where: { brandId: car.brandId },
      },
      id: true,
      name: true,
      status: true,
    },
    where: { id: { in: garageIds } },
  });
  const byId = new Map(garages.map((garage) => [garage.id, garage]));
  for (const id of garageIds) {
    const garage = byId.get(id);
    if (!garage) throw cannotReceive(id, '', 'not_taking_requests');
    const reason = refusedFor(garage, car.fuel, jobTypeIds);
    if (reason) throw cannotReceive(id, garage.name, reason);
  }
}

function refusedFor(
  garage: {
    status: string;
    brands: ({ stance: string; jobs: unknown[] } & Record<Fuel, boolean>)[];
  },
  fuel: Fuel,
  jobTypeIds: string[],
): CannotReceiveReason | null {
  if (garage.status !== 'approved') return 'not_taking_requests';
  const [row] = garage.brands;
  if (row?.stance !== 'works_on') return 'brand';
  if (!row[fuel]) return 'fuel';
  if (jobTypeIds.length > 0 && row.jobs.length === 0) return 'jobs';
  return null;
}

function outcomeOf(error: unknown): SendOutcome | null {
  if (!(error instanceof HttpException)) return null;
  const body = error.getResponse() as { code?: string };
  if (body.code === 'garage_cannot_receive') return 'cannot_receive';
  if (body.code === 'too_many_requests') return 'limit';
  if (body.code === 'validation_failed') return 'invalid';
  return null;
}

// A driver sends one request to the garages it ticked. The account row is
// locked first, so two sends from one driver (the same key twice, or the
// 20th of the day twice) run one after the other.
@Injectable()
export class QuoteRequestsService {
  private readonly logger = new Logger('QuoteRequests');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    private readonly requests: RequestsService,
  ) {}

  async send(
    actor: Actor,
    key: string,
    dto: CreateQuoteRequestDto,
  ): Promise<RequestDto> {
    requireCapability(actor, 'driver.requests');
    try {
      assertShape(dto);
      const id = await this.store(actor, key, dto);
      recordSend('sent', dto.garageIds.length);
      this.logger.log(`quote request sent: ${id}`);
      return this.requests.get(actor, id);
    } catch (error) {
      const outcome = outcomeOf(error);
      if (outcome) {
        recordSend(outcome);
        this.logger.warn(`quote request refused: ${outcome}`);
      }
      throw error;
    }
  }

  private store(actor: Actor, key: string, dto: CreateQuoteRequestDto) {
    const driverId = actor.accountId;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM account WHERE id = ${driverId}::uuid FOR UPDATE`;
      const sent = await tx.quoteRequest.findUnique({
        select: { id: true },
        where: { driverId_idempotencyKey: { driverId, idempotencyKey: key } },
      });
      if (sent) return sent.id;
      const car = await tx.car.findFirst({
        include: { brand: { select: { name: true } } },
        where: { id: dto.carId, ownerId: driverId, removedAt: null },
      });
      if (!car) throw new NotFoundException();
      const known = await tx.jobType.count({
        where: { id: { in: dto.jobTypeIds }, status: 'approved' },
      });
      if (known !== dto.jobTypeIds.length) {
        throw invalid(
          'jobTypeIds',
          'unknown_job',
          'No such job in the catalogue',
        );
      }
      await assertRouted(tx, car, dto.garageIds, dto.jobTypeIds);
      const now = new Date();
      const today = await tx.quoteRequest.count({
        where: { createdAt: { gte: atLocal(localDay(now), 0) }, driverId },
      });
      if (today >= REQUEST_DAILY_LIMIT) {
        throw refusal(
          HttpStatus.TOO_MANY_REQUESTS,
          'too_many_requests',
          `A driver sends at most ${REQUEST_DAILY_LIMIT} requests a day`,
        );
      }
      const request = await tx.quoteRequest.create({
        data: {
          carBrand: car.brand.name,
          carEngine: car.engine,
          carFuel: car.fuel,
          carId: car.id,
          carModel: car.model,
          carYear: car.year,
          createdAt: now,
          description: dto.description ?? null,
          driverId,
          expiresAt: addLocalDays(now, REQUEST_VALIDITY_DAYS),
          idempotencyKey: key,
          jobs: {
            create: dto.jobTypeIds.map((jobTypeId, index) => ({
              jobTypeId,
              position: index + 1,
            })),
          },
          recipients: {
            create: dto.garageIds.map((garageId, index) => ({
              garageId,
              source: dto.sources[index],
            })),
          },
        },
      });
      // No description and no plate: admins read the audit history.
      await this.audit.record(tx, {
        action: 'create',
        actorId: driverId,
        actorRole: actor.role,
        carId: car.id,
        newValue: { garageIds: dto.garageIds, jobTypeIds: dto.jobTypeIds },
        subjectId: request.id,
        subjectType: 'quote_request',
      });
      // Ids only: the outbox is read beyond the driver.
      await this.events.record(tx, {
        audience: {
          driverAccountId: driverId,
          garageIds: dto.garageIds,
          type: 'request',
        },
        kind: 'request.created',
        payload: { driverId, garageIds: dto.garageIds, requestId: request.id },
        subjectId: request.id,
      });
      return request.id;
    });
  }

  // Up to five more garages near the place that would take the request, in
  // the garage search's order; none without a place.
  async candidates(
    actor: Actor,
    query: CandidateGaragesQueryDto,
  ): Promise<CandidateGarageListDto> {
    requireCapability(actor, 'driver.requests');
    const car = await this.prisma.car.findFirst({
      select: { brandId: true, fuel: true },
      where: { id: query.carId, ownerId: actor.accountId, removedAt: null },
    });
    if (!car) throw new NotFoundException();
    const point = parseNear(query.near);
    if (!point) return { items: [] };
    const area = await garagesInArea(this.prisma, point);
    area.delete(query.exclude ?? '');
    const garages = await this.prisma.garage.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, slug: true },
      take: REQUEST_MAX_GARAGES,
      where: {
        id: { in: [...area.keys()] },
        ...takes(car, query.jobTypeIds ?? []),
      },
    });
    return {
      items: garages.map((garage) => {
        const { distanceM, mobile } = area.get(garage.id) as {
          distanceM: number;
          mobile: boolean;
        };
        return {
          ...garage,
          comesToYou: mobile,
          distanceKm: mobile ? null : Math.round(distanceM / 100) / 10,
        };
      }),
    };
  }
}
