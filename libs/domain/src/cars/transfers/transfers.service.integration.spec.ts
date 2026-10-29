import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import type { TransferSending } from './transfers';
import {
  sendTransfer,
  tokenOf,
  transfersApp,
  transfersWorld,
} from './transfers.testing';
import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import { BrevoMock } from '../../notifications/brevo/brevo-mock.testing';
import { databaseUrl } from '../../notifications/notifications.testing';

const BUYER = '+40722123456';
const world = transfersWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

const brevo = new BrevoMock();
let app: NestExpressApplication;
let restore: () => void;
let sending: TransferSending;
let since: Date;
let mark: bigint;

beforeAll(async () => {
  await brevo.start();
  ({ app, restore, sending } = await transfersApp(brevo));
});

afterAll(async () => {
  await app.close();
  await brevo.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await world.reset();
  brevo.reset();
  restore();
  ({ mark, since } = await world.marks());
});

afterEach(() => {
  jest.restoreAllMocks();
});

const http = () => request(app.getHttpServer());
const send = (auth: string, carId: string, body: Record<string, unknown>) =>
  sendTransfer(app, auth, carId, body);

async function seller(name = 'andrei') {
  const who = await world.driver(name, { phone: '+40733000111' });
  const car = await world.car(who.id);
  return { ...who, car };
}

// Every log line written while `run` runs, at every level.
async function logged(run: () => Promise<unknown>) {
  const lines: string[] = [];
  for (const level of ['log', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation(((
      message: unknown,
    ) => {
      lines.push(String(message));
    }) as never);
  }
  await run();
  return lines.join('\n');
}

// @traces 415-FR-002
// @traces 415-FR-021
// @traces 415-FR-004
describe('a send', () => {
  it.each(['0722 123 456', '0722.123.456', '0040722123456'])(
    'stores the transfer sent with the phone %p in E.164',
    async (typed) => {
      const { auth, car, id } = await seller();

      const res = await send(auth, car.id, {
        buyerPhone: typed,
        repairIds: [],
      });

      expect(res.status).toBe(201);
      const row = await prisma.carTransfer.findUniqueOrThrow({
        where: { id: res.body.transfer.id },
      });
      expect(row).toMatchObject({
        buyerId: null,
        buyerPhone: BUYER,
        carId: car.id,
        saleDate: null,
        sellerId: id,
        status: 'sent',
      });
      expect(row.expiresAt.getTime() - row.sentAt.getTime()).toBe(
        7 * 86_400_000,
      );
    },
  );

  it('stores the ticked repairs alone, duplicates collapsed', async () => {
    const { auth, car } = await seller();
    const ticked = await world.logged(car.id, { what: 'Frâne' });
    await world.logged(car.id, { what: 'Neticuit' });

    const res = await send(auth, car.id, {
      buyerPhone: BUYER,
      repairIds: [ticked.id, ticked.id],
    });

    expect(res.status).toBe(201);
    expect(
      await prisma.carTransferRepair.findMany({
        where: { transferId: res.body.transfer.id },
      }),
    ).toEqual([{ repairId: ticked.id, transferId: res.body.transfer.id }]);
  });

  it('stores no ticked rows when none is ticked', async () => {
    const { auth, car } = await seller();
    await world.logged(car.id);

    await send(auth, car.id, { buyerPhone: BUYER, repairIds: [] });

    expect(await prisma.carTransferRepair.count()).toBe(0);
  });

  it.each([
    ['a MotorFix repair', 'motorfix'],
    ['a deleted repair', 'deleted'],
    ['another car’s repair', 'foreign'],
    ['an unknown repair', 'unknown'],
  ])(
    'refuses a tick on %s with 400 repair_not_tickable, storing nothing',
    async (_, which) => {
      const { auth, car, id } = await seller();
      const otherCar = await world.car(id);
      const good = await world.logged(car.id);
      const bad =
        which === 'motorfix'
          ? (await world.throughMotorFix(id, car.id)).id
          : which === 'deleted'
            ? (await world.logged(car.id, { deleted: true })).id
            : which === 'foreign'
              ? (await world.logged(otherCar.id)).id
              : '00000000-0000-4000-8000-000000000000';

      const res = await send(auth, car.id, {
        buyerPhone: BUYER,
        repairIds: [good.id, bad],
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('repair_not_tickable');
      expect(await prisma.carTransfer.count()).toBe(0);
      expect(brevo.whatsapp()).toHaveLength(0);
    },
  );

  it('cancels the car’s earlier sent transfer, whose link then answers 410', async () => {
    const { auth, car } = await seller();
    const first = await send(auth, car.id, {
      buyerPhone: BUYER,
      repairIds: [],
    });

    const second = await send(auth, car.id, {
      buyerPhone: '+40722999888',
      repairIds: [],
    });

    expect(second.status).toBe(201);
    expect(
      await prisma.carTransfer.findUniqueOrThrow({
        where: { id: first.body.transfer.id },
      }),
    ).toMatchObject({ status: 'cancelled' });
    const link = await http().get(`/car-transfers/${tokenOf(first.body.link)}`);
    expect(link.status).toBe(410);
    expect(link.body.code).toBe('transfer_cancelled');
    expect(await prisma.carTransfer.count({ where: { status: 'sent' } })).toBe(
      1,
    );
  });

  it('keeps the transfers of other cars sent', async () => {
    const { auth, car, id } = await seller();
    const other = await world.car(id);
    const kept = await send(auth, other.id, {
      buyerPhone: BUYER,
      repairIds: [],
    });

    await send(auth, car.id, { buyerPhone: BUYER, repairIds: [] });

    expect(
      await prisma.carTransfer.findUniqueOrThrow({
        where: { id: kept.body.transfer.id },
      }),
    ).toMatchObject({ status: 'sent' });
  });

  it('rolls everything back when the audit write fails', async () => {
    const { auth, car } = await seller();
    const ticked = await world.logged(car.id);
    jest
      .spyOn(AuditService.prototype, 'record')
      .mockRejectedValueOnce(new Error('audit down'));

    const res = await send(auth, car.id, {
      buyerPhone: BUYER,
      repairIds: [ticked.id],
    });

    expect(res.status).toBe(500);
    expect(await prisma.carTransfer.count()).toBe(0);
    expect(await prisma.carTransferRepair.count()).toBe(0);
    expect(await world.transferEvents(mark)).toHaveLength(0);
    expect(brevo.whatsapp()).toHaveLength(0);
  });

  it('is refused when a request for the car commits while the send waits', async () => {
    const { auth, car, id } = await seller();
    let pending: Promise<request.Response> | undefined;
    let settled = false;

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM account WHERE id = ${id}::uuid FOR UPDATE`;
      pending = send(auth, car.id, { buyerPhone: BUYER, repairIds: [] }).then(
        (res) => {
          settled = true;
          return res;
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      await tx.quoteRequest.create({
        data: {
          carBrand: 'Mini',
          carFuel: 'petrol',
          carId: car.id,
          carModel: 'Cooper S',
          carYear: 2019,
          driverId: id,
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
          idempotencyKey: `held-${id}`,
          status: 'sent',
        },
      });
    });
    const res = await pending;

    expect(res?.status).toBe(409);
    expect(res?.body.code).toBe('open_request');
    expect(await prisma.carTransfer.count()).toBe(0);
  });
});

// @traces 415-FR-006
describe('a WhatsApp message that does not leave', () => {
  it.each([
    ['the provider refuses it', 'provider'],
    ['the template is not configured', 'template'],
    ['the number is not allowed', 'blocked'],
  ])('leaves the transfer sent and answers failed when %s', async (_, how) => {
    const { auth, car } = await seller();
    if (how === 'provider') brevo.answer({ status: 400 });
    if (how === 'template') sending.config.whatsappTemplates = {};
    const buyer = how === 'blocked' ? '+40622123456' : BUYER;

    let res: request.Response | undefined;
    const log = await logged(async () => {
      res = await send(auth, car.id, { buyerPhone: buyer, repairIds: [] });
    });

    expect(res?.status).toBe(201);
    expect(res?.body.whatsapp).toBe('failed');
    expect(
      await prisma.carTransfer.findUniqueOrThrow({
        where: { id: res?.body.transfer.id },
      }),
    ).toMatchObject({ status: 'sent' });
    expect(log).toContain(`transfer link not sent: whatsapp_failed (`);
    expect(log).toContain(`transfer=${res?.body.transfer.id}`);
    expect(log).not.toContain(buyer.slice(1));
    expect(log).not.toContain(tokenOf(res?.body.link));
  });
});

// @traces 415-FR-020
describe('what a send counts and logs', () => {
  it('counts the send and the WhatsApp outcome', async () => {
    const reader = countedMetrics();
    const { auth, car, id } = await seller();
    await send(auth, car.id, { buyerPhone: BUYER, repairIds: [] });
    brevo.answer({ status: 400 });
    await send(auth, car.id, { buyerPhone: BUYER, repairIds: [] });
    await world.request(id, { carId: car.id, status: 'sent' });
    await send(auth, car.id, { buyerPhone: BUYER, repairIds: [] });

    expect(
      await counterTotal(reader, 'motorfix_car_transfer_sends_total', {
        outcome: 'sent',
      }),
    ).toBe(2);
    expect(
      await counterTotal(reader, 'motorfix_car_transfer_sends_total', {
        outcome: 'open_request',
      }),
    ).toBe(1);
    expect(
      await counterTotal(reader, 'motorfix_car_transfer_whatsapp_total', {
        kind: 'none',
        outcome: 'sent',
      }),
    ).toBe(1);
    expect(
      await counterTotal(reader, 'motorfix_car_transfer_whatsapp_total', {
        outcome: 'failed',
      }),
    ).toBe(1);
  });

  it('logs neither the phone nor the token nor the link on a send and a cancel', async () => {
    const { auth, car } = await seller();
    let link = '';
    const log = await logged(async () => {
      const res = await send(auth, car.id, {
        buyerPhone: BUYER,
        repairIds: [],
      });
      link = res.body.link;
      await http()
        .post(`/cars/${car.id}/transfers/${res.body.transfer.id}/cancel`)
        .set('Authorization', auth);
      await http().get(`/car-transfers/${tokenOf(link)}`);
    });

    expect(log).not.toContain('722123456');
    expect(log).not.toContain(tokenOf(link));
  });
});

// @traces 415-FR-011
// @traces 415-FR-014
describe('what each step writes beside the transfer', () => {
  it('writes one create entry and car_transfer.sent on a send', async () => {
    const { auth, car, id } = await seller();
    const ticked = await world.logged(car.id);

    const res = await send(auth, car.id, {
      buyerPhone: BUYER,
      repairIds: [ticked.id],
    });

    const entries = await world.transferAudit(since);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'create',
      actorId: id,
      carId: car.id,
      subjectId: res.body.transfer.id,
      subjectType: 'car_transfer',
    });
    expect(entries[0].newValue).toEqual({
      carId: car.id,
      expiresAt: res.body.transfer.expiresAt,
      repairIds: [ticked.id],
    });
    const events = await world.transferEvents(mark);
    expect(events.map((e) => e.kind)).toEqual(['car_transfer.sent']);
    expect(events[0].payload).toEqual({
      carId: car.id,
      sellerAccountId: id,
      status: 'sent',
      transferId: res.body.transfer.id,
    });
    expect(events[0].audience).toEqual([`account:${id}`]);
  });

  it('writes an update entry and car_transfer.cancelled for the transfer a new send replaces', async () => {
    const { auth, car, id } = await seller();
    const first = await send(auth, car.id, {
      buyerPhone: BUYER,
      repairIds: [],
    });
    ({ mark, since } = await world.marks());

    await send(auth, car.id, { buyerPhone: BUYER, repairIds: [] });

    const cancelled = (await world.transferAudit(since)).filter(
      (e) => e.subjectId === first.body.transfer.id,
    );
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]).toMatchObject({
      action: 'update',
      actorId: id,
      field: 'status',
      newValue: 'cancelled',
      oldValue: 'sent',
    });
    expect((await world.transferEvents(mark)).map((e) => e.kind)).toEqual([
      'car_transfer.cancelled',
      'car_transfer.sent',
    ]);
  });

  it('writes an update entry and car_transfer.cancelled on the seller’s cancel', async () => {
    const { auth, car, id } = await seller();
    const sent = await send(auth, car.id, { buyerPhone: BUYER, repairIds: [] });
    ({ mark, since } = await world.marks());

    await http()
      .post(`/cars/${car.id}/transfers/${sent.body.transfer.id}/cancel`)
      .set('Authorization', auth);

    const entries = await world.transferAudit(since);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'update',
      actorId: id,
      field: 'status',
      newValue: 'cancelled',
      oldValue: 'sent',
      subjectId: sent.body.transfer.id,
    });
    const events = await world.transferEvents(mark);
    expect(events.map((e) => e.kind)).toEqual(['car_transfer.cancelled']);
    expect(events[0].payload).toEqual({
      carId: car.id,
      sellerAccountId: id,
      status: 'cancelled',
      transferId: sent.body.transfer.id,
    });
  });

  it('puts neither the phone nor the token in any entry or event', async () => {
    const { auth, car } = await seller();
    const sent = await send(auth, car.id, { buyerPhone: BUYER, repairIds: [] });
    await send(auth, car.id, { buyerPhone: BUYER, repairIds: [] });

    const written = JSON.stringify(
      [await world.transferAudit(since), await world.transferEvents(mark)],
      (_, v) => (typeof v === 'bigint' ? String(v) : v),
    );
    expect(written).not.toContain('722123456');
    expect(written).not.toContain(tokenOf(sent.body.link));
  });
});

// @traces 415-FR-012
describe('removing a car with a sent transfer', () => {
  it('cancels the transfer in the removal, with its entry and event, and the link answers 410', async () => {
    const { auth, car, id } = await seller();
    const sent = await send(auth, car.id, { buyerPhone: BUYER, repairIds: [] });
    ({ mark, since } = await world.marks());

    const res = await http()
      .delete(`/cars/${car.id}`)
      .set('Authorization', auth);

    expect(res.status).toBe(204);
    expect(
      await prisma.carTransfer.findUniqueOrThrow({
        where: { id: sent.body.transfer.id },
      }),
    ).toMatchObject({ status: 'cancelled' });
    expect(await world.transferAudit(since)).toEqual([
      expect.objectContaining({
        action: 'update',
        actorId: id,
        field: 'status',
        newValue: 'cancelled',
        oldValue: 'sent',
        subjectId: sent.body.transfer.id,
      }),
    ]);
    expect((await world.transferEvents(mark)).map((e) => e.kind)).toEqual([
      'car_transfer.cancelled',
    ]);
    const link = await http().get(`/car-transfers/${tokenOf(sent.body.link)}`);
    expect(link.status).toBe(410);
    expect(link.body.code).toBe('transfer_cancelled');
  });

  it('keeps the transfer sent when the removal is refused for an open request', async () => {
    const { auth, car, id } = await seller();
    const sent = await send(auth, car.id, { buyerPhone: BUYER, repairIds: [] });
    await world.request(id, { carId: car.id, status: 'booked' });

    const res = await http()
      .delete(`/cars/${car.id}`)
      .set('Authorization', auth);

    expect(res.status).toBe(409);
    expect(
      await prisma.carTransfer.findUniqueOrThrow({
        where: { id: sent.body.transfer.id },
      }),
    ).toMatchObject({ status: 'sent' });
  });
});

// @traces 415-FR-001
// @traces 415-FR-002
// @traces 415-FR-009
describe('what the database holds to', () => {
  const row = (carId: string, sellerId: string, data = {}) =>
    prisma.carTransfer.create({
      data: {
        buyerPhone: BUYER,
        carId,
        expiresAt: new Date(Date.now() + 86_400_000),
        sellerId,
        tokenHash: `${Math.random()}`,
        ...data,
      },
    });

  it('refuses a MotorFix repair without its job and a logged one with a job', async () => {
    const { car, id } = await seller();
    const motorfix = await world.throughMotorFix(id, car.id);

    await expect(
      prisma.repair.create({
        data: {
          carId: car.id,
          doneOn: new Date('2026-01-01'),
          garageName: 'X',
          source: 'motorfix',
          what: 'Y',
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.repair.update({
        data: { source: 'logged' },
        where: { id: motorfix.id },
      }),
    ).rejects.toThrow();
  });

  it('refuses a phone that is not E.164 and an expiry not after the sending', async () => {
    const { car, id } = await seller();

    await expect(
      row(car.id, id, { buyerPhone: '0722123456' }),
    ).rejects.toThrow();
    await expect(
      row(car.id, id, { expiresAt: new Date(0), sentAt: new Date(0) }),
    ).rejects.toThrow();
  });

  it('refuses a second sent transfer of the same car', async () => {
    const { car, id } = await seller();
    await row(car.id, id);

    await expect(row(car.id, id)).rejects.toThrow();
    await expect(
      row(car.id, id, { status: 'cancelled' }),
    ).resolves.toBeTruthy();
  });

  it('drops the transfers and their ticked rows with the seller’s account', async () => {
    const { auth, car, id } = await seller();
    const ticked = await world.logged(car.id);
    await send(auth, car.id, { buyerPhone: BUYER, repairIds: [ticked.id] });

    await prisma.account.delete({ where: { id } });

    expect(await prisma.carTransfer.count()).toBe(0);
    expect(await prisma.carTransferRepair.count()).toBe(0);
  });
});
