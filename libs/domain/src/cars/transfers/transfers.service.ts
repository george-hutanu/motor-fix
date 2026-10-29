import {
  CAR_TRANSFER_LINK_VALID_DAYS,
  type CarSaleDto,
  type CarTransferAcceptedDto,
  type CarTransferLinkDto,
  type CarTransferSentDto,
  type CreateCarTransferDto,
  normalisePhone,
} from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import {
  cancelSentTransfer,
  cancelTransfer,
  isLive,
  recordStep,
  TRANSFER_SENDING,
  type TransferSending,
  transferEvent,
  transferLink,
} from './transfers';
import {
  ACCEPT_OUTCOMES,
  type AcceptOutcome,
  recordAccept,
  recordSend,
  recordWhatsApp,
} from './transfers.metrics';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { AccountsService } from '../../auth/accounts.service';
import {
  hashToken,
  newToken,
} from '../../auth/email-confirmation/email-confirmation';
import { refusal } from '../../auth/http-refusal';
import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { localDay } from '../../bucharest';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { sendWhatsAppDirect } from '../../notifications/whatsapp-direct';
import { shortName } from '../../quotes/reads';
import { openRow, REPAIR_ORDER, repairWhere } from '../history/history';
import {
  editEntry,
  LIMIT,
  OPEN_REQUEST,
  ownCar,
} from '../my-cars/cars/cars.service';

const DAY_MS = 86_400_000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such transfer');

const openRequest = () =>
  refusal(
    HttpStatus.CONFLICT,
    'open_request',
    'The car has a request under way',
  );

const openRequests = (tx: Prisma.TransactionClient, carId: string) =>
  tx.quoteRequest.count({
    where: { carId, status: { in: [...OPEN_REQUEST] } },
  });

// What the link answers once the transfer is no longer sent.
const GONE = {
  accepted: 'transfer_accepted',
  cancelled: 'transfer_cancelled',
  expired: 'transfer_expired',
} as const;

// A transfer's status as the link answers it: a removed car's transfer is
// cancelled, whichever way the car went, and the time decides an expiry.
function linkStatus(transfer: {
  car: { removedAt: Date | null };
  expiresAt: Date;
  status: 'sent' | 'accepted' | 'cancelled' | 'expired';
}) {
  if (transfer.status !== 'sent') return transfer.status;
  if (transfer.car.removedAt) return 'cancelled';
  return isLive(transfer.expiresAt, new Date()) ? 'sent' : 'expired';
}

const gone = (status: keyof typeof GONE) =>
  refusal(HttpStatus.GONE, GONE[status], 'The link no longer works');

const ownTransfer = () =>
  refusal(
    HttpStatus.FORBIDDEN,
    'own_transfer',
    'The seller cannot take over their own car',
  );

const day = (at: Date | null) => at?.toISOString().slice(0, 10) ?? null;

// The refusal code an accept was answered, when it is one it counts.
function acceptOutcome(error: unknown): AcceptOutcome | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const { code } = error.getResponse() as { code?: string };
  return ACCEPT_OUTCOMES.find((outcome) => outcome === code);
}

interface Takeover {
  buyerId: string;
  carId: string;
  id: string;
  sellerId: string;
}
interface SoldCar {
  plate: string | null;
  rcaUntil: Date | null;
  rovinietaUntil: Date | null;
}

// Takes the accept's locks and answers its refusals, in FR-004's order:
// 410, 403, car_limit, open_request (the 404 is the caller's).
async function lockedForTakeover(
  tx: Prisma.TransactionClient,
  { buyerId, carId, id, sellerId }: Takeover,
): Promise<SoldCar> {
  for (const account of [...new Set([sellerId, buyerId])].sort()) {
    await tx.$queryRaw`SELECT id FROM account WHERE id = ${account}::uuid FOR UPDATE`;
  }
  await tx.$queryRaw`SELECT id FROM car WHERE id = ${carId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM car_transfer WHERE id = ${id}::uuid FOR UPDATE`;
  const transfer = await tx.carTransfer.findUniqueOrThrow({
    select: {
      car: {
        select: {
          plate: true,
          rcaUntil: true,
          removedAt: true,
          rovinietaUntil: true,
        },
      },
      expiresAt: true,
      status: true,
    },
    where: { id },
  });
  const status = linkStatus(transfer);
  if (status !== 'sent') throw gone(status);
  if (buyerId === sellerId) throw ownTransfer();
  const held = await tx.car.count({
    where: { ownerId: buyerId, removedAt: null },
  });
  if (held >= LIMIT) {
    throw refusal(
      HttpStatus.CONFLICT,
      'car_limit',
      `An account holds at most ${LIMIT} cars`,
    );
  }
  if ((await openRequests(tx, carId)) > 0) throw openRequest();
  return transfer.car;
}

// The car, its ownership rows, the transfer and the reminders move to the
// buyer on the Bucharest day of now.
async function handOver(
  tx: Prisma.TransactionClient,
  { buyerId, carId, id, sellerId }: Takeover,
) {
  const now = new Date();
  const saleDate = new Date(`${localDay(now)}T00:00:00Z`);
  // The seller's add key is spent: kept, it could collide with the buyer's
  // own (owner, key) pair.
  await tx.car.update({
    data: {
      idempotencyKey: null,
      ownerId: buyerId,
      plate: null,
      rcaUntil: null,
      rovinietaUntil: null,
    },
    where: { id: carId },
  });
  const closed = await tx.carOwnership.updateMany({
    data: { access: 'former_owner_read_only', closedAt: now, toDate: saleDate },
    where: { accountId: sellerId, carId, toDate: null },
  });
  if (closed.count !== 1) {
    throw new Error(`car ${carId} has no open row for its seller`);
  }
  await tx.carOwnership.create({
    data: {
      access: 'owner',
      accountId: buyerId,
      carId,
      fromDate: saleDate,
      openedAt: now,
      transferId: id,
    },
  });
  await tx.carTransfer.update({
    data: { buyerId, saleDate, status: 'accepted' },
    where: { id },
  });
  // The insurance and the vignette were the seller's; every other reminder
  // goes with the car, its stages kept.
  await tx.reminder.deleteMany({
    where: { carId, kind: { in: ['rca', 'rovinieta'] } },
  });
  await tx.reminder.updateMany({
    data: { accountId: buyerId },
    where: { carId },
  });
}

// A seller hands a car and its history to a buyer: a link sent on WhatsApp,
// valid for 7 days, of which only the hash is kept.
@Injectable()
export class CarTransfersService {
  private readonly logger = new Logger('CarTransfers');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    @Inject(TRANSFER_SENDING) private readonly sending: TransferSending,
    private readonly accounts: AccountsService,
  ) {}

  // What the sell dialog reads: whether a sale may start, the repairs that
  // go with the car and the transfer already sent.
  async sale(actor: Actor, carId: string): Promise<CarSaleDto> {
    requireCapability(actor, 'driver.cars');
    const car = await this.prisma.car.findFirst({
      select: {
        transfers: {
          select: { buyerPhone: true, expiresAt: true, id: true },
          where: { status: 'sent' },
        },
      },
      where: { id: carId, ownerId: actor.accountId, removedAt: null },
    });
    const row = car && (await openRow(this.prisma, carId, actor.accountId));
    if (!car || !row) {
      throw refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such car');
    }
    // Only what the seller may read goes with the car (1265-FR-013).
    const repairs = await this.prisma.repair.findMany({
      orderBy: REPAIR_ORDER,
      select: {
        doneOn: true,
        garageName: true,
        id: true,
        source: true,
        what: true,
      },
      where: repairWhere(row),
    });
    const open = await openRequests(this.prisma, carId);
    const sent = car.transfers.find((t) => isLive(t.expiresAt, new Date()));
    return {
      canStart: open === 0,
      reason: open === 0 ? null : 'open_request',
      repairs: repairs.map((r) => ({
        ...r,
        doneOn: r.doneOn.toISOString().slice(0, 10),
      })),
      transfer: sent
        ? {
            buyerPhone: sent.buyerPhone,
            expiresAt: sent.expiresAt.toISOString(),
            id: sent.id,
          }
        : null,
    };
  }

  // The account row is locked first, as a request's send locks it: a request
  // sent meanwhile is counted, not missed.
  async send(
    actor: Actor,
    carId: string,
    dto: CreateCarTransferDto,
  ): Promise<CarTransferSentDto> {
    requireCapability(actor, 'driver.cars');
    const { webUrl } = this.sending;
    if (!webUrl) throw new Error('PUBLIC_WEB_URL is not set');
    const buyerPhone = normalisePhone(dto.buyerPhone);
    if (!buyerPhone) {
      throw refusal(
        HttpStatus.BAD_REQUEST,
        'invalid_phone',
        'Not a phone number',
      );
    }
    const sellerId = actor.accountId;
    const seller = await this.prisma.account.findUniqueOrThrow({
      select: { language: true, phone: true },
      where: { id: sellerId },
    });
    if (seller.phone === buyerPhone) {
      throw refusal(
        HttpStatus.BAD_REQUEST,
        'own_phone',
        'The buyer’s phone is the seller’s own',
      );
    }
    const repairIds = [...new Set(dto.repairIds)];
    const { hash, token } = newToken();
    let busy = false;
    const made = await this.prisma
      .$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM account WHERE id = ${sellerId}::uuid FOR UPDATE`;
        const car = await ownCar(tx, carId, sellerId);
        if ((await openRequests(tx, carId)) > 0) {
          busy = true;
          throw openRequest();
        }
        const row = await openRow(tx, carId, sellerId);
        const tickable = row
          ? await tx.repair.count({
              where: {
                AND: [repairWhere(row), { id: { in: repairIds } }],
                source: 'logged',
              },
            })
          : 0;
        if (tickable !== repairIds.length) {
          throw refusal(
            HttpStatus.BAD_REQUEST,
            'repair_not_tickable',
            'Only the car’s own logged repairs can be ticked',
          );
        }
        const ports = { audit: this.audit, events: this.events };
        await cancelSentTransfer(tx, ports, carId, {
          accountId: sellerId,
          role: actor.role,
        });
        const sentAt = new Date();
        const transfer = await tx.carTransfer.create({
          data: {
            buyerPhone,
            carId,
            expiresAt: new Date(
              sentAt.getTime() + CAR_TRANSFER_LINK_VALID_DAYS * DAY_MS,
            ),
            repairs: { create: repairIds.map((repairId) => ({ repairId })) },
            sellerId,
            sentAt,
            tokenHash: hash,
          },
          select: { carId: true, expiresAt: true, id: true, sellerId: true },
        });
        // Never the phone or the token.
        await this.audit.record(tx, {
          action: 'create',
          actorId: sellerId,
          actorRole: actor.role,
          carId,
          newValue: {
            carId,
            expiresAt: transfer.expiresAt.toISOString(),
            repairIds,
          },
          subjectId: transfer.id,
          subjectType: 'car_transfer',
        });
        await transferEvent(this.events, tx, transfer, 'sent');
        return { car: `${car.brand.name} ${car.model}`, transfer };
      })
      .catch((error: unknown) => {
        if (busy) recordSend('open_request');
        throw error;
      });
    recordSend('sent');
    const link = transferLink(webUrl, seller.language, token);
    const failed = await sendWhatsAppDirect(
      this.sending,
      'CAR_TRANSFER_LINK',
      seller.language,
      { car: made.car, days: CAR_TRANSFER_LINK_VALID_DAYS, link },
      buyerPhone,
    );
    recordWhatsApp(failed);
    if (failed) {
      this.logger.warn(
        `transfer link not sent: whatsapp_failed (${failed}) transfer=${made.transfer.id}`,
      );
    }
    return {
      link,
      transfer: {
        expiresAt: made.transfer.expiresAt.toISOString(),
        id: made.transfer.id,
      },
      whatsapp: failed ? 'failed' : 'sent',
    };
  }

  async cancel(actor: Actor, carId: string, transferId: string) {
    requireCapability(actor, 'driver.cars');
    const sellerId = actor.accountId;
    await this.prisma.$transaction(async (tx) => {
      await ownCar(tx, carId, sellerId);
      const transfer = await tx.carTransfer.findFirst({
        select: { carId: true, id: true, sellerId: true, status: true },
        where: { carId, id: transferId },
      });
      if (!transfer) throw notFound();
      if (transfer.status !== 'sent') {
        throw refusal(
          HttpStatus.CONFLICT,
          'not_sent',
          'The transfer is no longer sent',
        );
      }
      await cancelTransfer(
        tx,
        { audit: this.audit, events: this.events },
        transfer,
        { accountId: sellerId, role: actor.role },
      );
    });
  }

  // What the link says to whoever opens it: its status alone to a visitor;
  // the car, what goes with it and the seller's short name to an account.
  async read(token: string, actor?: Actor): Promise<CarTransferLinkDto> {
    if (!TOKEN.test(token)) throw notFound();
    const transfer = await this.prisma.carTransfer.findUnique({
      select: {
        car: {
          select: {
            brand: { select: { name: true } },
            model: true,
            removedAt: true,
            year: true,
          },
        },
        carId: true,
        expiresAt: true,
        id: true,
        seller: { select: { name: true } },
        sellerId: true,
        status: true,
      },
      where: { tokenHash: hashToken(token) },
    });
    if (!transfer) throw notFound();
    const status = linkStatus(transfer);
    if (status !== 'sent') throw gone(status);
    if (!actor) return { status };
    if (actor.accountId === transfer.sellerId) throw ownTransfer();
    // What the buyer's row will read on the day: every MotorFix repair and
    // the ticked ones still active.
    const repairCount = await this.prisma.repair.count({
      where: {
        carId: transfer.carId,
        deletedAt: null,
        OR: [
          { source: 'motorfix' },
          { transfers: { some: { transferId: transfer.id } } },
        ],
      },
    });
    const { car } = transfer;
    return {
      car: { brand: car.brand.name, model: car.model, year: car.year },
      repairCount,
      sellerName: shortName(transfer.seller.name) || null,
      status,
    };
  }

  // The buyer takes the car over: one transaction, counted by outcome.
  async accept(
    actor: Actor,
    token: string,
  ): Promise<CarTransferAcceptedDto & { sellerId: string }> {
    try {
      const taken = await this.takeOver(actor, token);
      recordAccept('accepted');
      this.logger.log(
        `transfer accepted transfer=${taken.transferId} car=${taken.carId}`,
      );
      return { carId: taken.carId, sellerId: taken.sellerId };
    } catch (error) {
      const outcome = acceptOutcome(error);
      if (outcome) recordAccept(outcome);
      throw error;
    }
  }

  // The account rows first (ascending ids), then the car, then the
  // transfer: the order the send and the cancel take, so none of them can
  // deadlock with this. The seller's row is the lock a quote request's
  // creation takes; the buyer's, the 20-car count's.
  private async takeOver(actor: Actor, token: string) {
    if (!TOKEN.test(token)) throw notFound();
    const found = await this.prisma.carTransfer.findUnique({
      select: { carId: true, id: true, sellerId: true },
      where: { tokenHash: hashToken(token) },
    });
    if (!found) throw notFound();
    const transfer = { ...found, buyerId: actor.accountId };
    return this.prisma.$transaction(async (tx) => {
      const car = await lockedForTakeover(tx, transfer);
      await handOver(tx, transfer);
      if (!actor.roles.includes('driver')) {
        await this.accounts.grantRole(
          tx,
          { id: transfer.buyerId, role: actor.role },
          transfer.buyerId,
          'driver',
        );
      }
      await this.recordTakeover(tx, actor, transfer, car);
      return { ...found, transferId: found.id };
    });
  }

  // One car entry per changed field, the plate's saying it was cleared, not
  // what it was; then the transfer's step and its event.
  private async recordTakeover(
    tx: Prisma.TransactionClient,
    actor: Actor,
    transfer: Takeover,
    car: SoldCar,
  ) {
    const entry = editEntry(actor, transfer.carId);
    await this.audit.recordChanges(
      tx,
      entry,
      {
        ownerId: transfer.sellerId,
        rcaUntil: day(car.rcaUntil),
        rovinietaUntil: day(car.rovinietaUntil),
      },
      { ownerId: transfer.buyerId, rcaUntil: null, rovinietaUntil: null },
    );
    if (car.plate !== null) {
      await this.audit.record(tx, {
        ...entry,
        action: 'update',
        field: 'plate',
        newValue: null,
        oldValue: null,
      });
    }
    await recordStep(
      tx,
      { audit: this.audit, events: this.events },
      transfer,
      'accepted',
      { accountId: transfer.buyerId, role: actor.role },
    );
  }
}
