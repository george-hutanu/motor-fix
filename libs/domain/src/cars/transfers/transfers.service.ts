import {
  CAR_TRANSFER_LINK_VALID_DAYS,
  type CarSaleDto,
  type CarTransferLinkDto,
  type CarTransferSentDto,
  type CreateCarTransferDto,
  normalisePhone,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';

import {
  cancelSentTransfer,
  cancelTransfer,
  isLive,
  TRANSFER_SENDING,
  type TransferSending,
  transferEvent,
  transferLink,
} from './transfers';
import { recordSend, recordWhatsApp } from './transfers.metrics';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import {
  hashToken,
  newToken,
} from '../../auth/email-confirmation/email-confirmation';
import { refusal } from '../../auth/http-refusal';
import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { sendWhatsAppDirect } from '../../notifications/whatsapp-direct';
import { OPEN_REQUEST, ownCar } from '../my-cars/cars/cars.service';

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
  ) {}

  // What the sell dialog reads: whether a sale may start, the repairs that
  // go with the car and the transfer already sent.
  async sale(actor: Actor, carId: string): Promise<CarSaleDto> {
    requireCapability(actor, 'driver.cars');
    const car = await this.prisma.car.findFirst({
      select: {
        repairs: {
          orderBy: [{ doneOn: 'desc' }, { createdAt: 'desc' }],
          select: {
            doneOn: true,
            garageName: true,
            id: true,
            source: true,
            what: true,
          },
          where: { deletedAt: null },
        },
        transfers: {
          select: { buyerPhone: true, expiresAt: true, id: true },
          where: { status: 'sent' },
        },
      },
      where: { id: carId, ownerId: actor.accountId, removedAt: null },
    });
    if (!car) {
      throw refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such car');
    }
    const open = await openRequests(this.prisma, carId);
    const sent = car.transfers.find((t) => isLive(t.expiresAt, new Date()));
    return {
      canStart: open === 0,
      reason: open === 0 ? null : 'open_request',
      repairs: car.repairs.map((r) => ({
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
        const tickable = await tx.repair.count({
          where: {
            carId,
            deletedAt: null,
            id: { in: repairIds },
            source: 'logged',
          },
        });
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

  // What the link says to whoever opens it: its status alone.
  async read(token: string): Promise<CarTransferLinkDto> {
    if (!TOKEN.test(token)) throw notFound();
    const transfer = await this.prisma.carTransfer.findUnique({
      select: {
        car: { select: { removedAt: true } },
        expiresAt: true,
        status: true,
      },
      where: { tokenHash: hashToken(token) },
    });
    if (!transfer) throw notFound();
    // A removed car's transfer is cancelled, whichever way the car went.
    const status =
      transfer.status !== 'sent'
        ? transfer.status
        : transfer.car.removedAt
          ? 'cancelled'
          : isLive(transfer.expiresAt, new Date())
            ? 'sent'
            : 'expired';
    if (status !== 'sent') {
      throw refusal(HttpStatus.GONE, GONE[status], 'The link no longer works');
    }
    return { status };
  }
}
