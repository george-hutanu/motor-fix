import type { LogRepairDto } from '@motor-fix/contracts';
import { Logger } from '@nestjs/common';

import { LogRepairModule } from './log-repair.module';
import { LogRepairService } from './log-repair.service';
import { AuditService } from '../../audit/audit.service';
import type { Actor } from '../../auth/policy';
import { addDays, localDay } from '../../bucharest';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import { quotesApp } from '../../quotes/quotes-api.testing';
import { ClientRepairsModule } from '../client-repairs/client-repairs.module';

// @traces 062-FR-007 062-FR-008 062-FR-010 062-FR-011 062-FR-012

const { bearer, post, provider, send, team, world } = quotesApp([
  LogRepairModule,
  ClientRepairsModule,
]);
const { prisma } = world;

const doneOn = addDays(localDay(new Date()), -10);
const body = (over: Partial<LogRepairDto> = {}) => ({
  costBani: 45_000,
  doneOn,
  garageName: '  Service Popescu  ',
  odometerKm: 148_250,
  what: '  Schimb plăcuțe frână  ',
  ...over,
});

async function scene() {
  const driverId = await world.account('Andrei Ion Marin');
  const car = await world.car(driverId);
  const auth = bearer(driverId, 'driver');
  return { auth, car, driverId };
}

const driver = (accountId: string, over: Partial<Actor> = {}): Actor => ({
  accountId,
  garageId: null,
  language: 'ro',
  permissions: {
    canAnswerQuotes: false,
    canMoveBookings: false,
    canRecordFinalPrice: false,
  },
  role: 'driver',
  roles: ['driver'],
  ...over,
});

const entries = (subjectId: string) =>
  prisma.activityLog.findMany({ where: { subjectId } });
const events = (subjectId: string) =>
  prisma.outboxEvent.findMany({ where: { kind: 'repair.logged', subjectId } });

describe('the saved repair', () => {
  it('stores the row as the driver’s logged repair, unshared', async () => {
    const { auth, car, driverId } = await scene();

    const res = await post(`/cars/${car.id}/repairs`, body(), auth);

    expect(res.status).toBe(201);
    const row = await prisma.repair.findUniqueOrThrow({
      where: { id: res.body.id },
    });
    expect(row).toMatchObject({
      carId: car.id,
      costBani: 45_000,
      deletedAt: null,
      doneOn: new Date(`${doneOn}T00:00:00Z`),
      garageId: null,
      garageName: 'Service Popescu',
      jobId: null,
      loggedBy: driverId,
      odometerKm: 148_250,
      sharedWithGarage: false,
      source: 'logged',
      updatedBy: driverId,
      updatedByRole: 'driver',
      what: 'Schimb plăcuțe frână',
    });
  });

  it('writes no odometer reading', async () => {
    const { auth, car } = await scene();
    await post(`/cars/${car.id}/repairs`, body(), auth);
    expect(
      await prisma.odometerReading.count({ where: { carId: car.id } }),
    ).toBe(0);
  });

  it('records one create entry by the driver, scoped to the car and garage', async () => {
    const { auth, car, driverId } = await scene();
    const garage = await world.garage('Garaj Nordic');

    const res = await post(
      `/cars/${car.id}/repairs`,
      body({ garageId: garage.id }),
      auth,
    );

    const list = await entries(res.body.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      action: 'create',
      actorId: driverId,
      actorRole: 'driver',
      carId: car.id,
      garageId: garage.id,
      subjectType: 'repair',
      viaAssistant: false,
    });
    expect(list[0]?.newValue).toMatchObject({
      costBani: 45_000,
      doneOn,
      garageId: garage.id,
      garageName: 'Garaj Nordic',
      odometerKm: 148_250,
      what: 'Schimb plăcuțe frână',
    });
  });

  it('records the assistant’s grant and request id when it calls', async () => {
    const { car, driverId } = await scene();
    const grant = '3d2c1b0a-9e8f-4a7b-8c6d-5e4f3a2b1c0d';

    const row = await provider(LogRepairService).log(
      driver(driverId, {
        assistantGrantId: grant,
        requestId: 'req-42',
        via: 'assistant',
      }),
      car.id,
      body() as LogRepairDto,
    );

    expect((await entries(row.id))[0]).toMatchObject({
      assistantGrantId: grant,
      requestId: 'req-42',
      viaAssistant: true,
    });
  });

  it('records one repair.logged event for the owner', async () => {
    const { auth, car, driverId } = await scene();

    const res = await post(`/cars/${car.id}/repairs`, body(), auth);

    const list = await events(res.body.id);
    expect(list).toHaveLength(1);
    expect(list[0]?.payload).toEqual({
      carId: car.id,
      garageId: null,
      ownerId: driverId,
      repairId: res.body.id,
    });
    expect(list[0]?.audience).toEqual([`account:${driverId}`]);
  });

  it.each([
    // Each module holds its own audit writer: the prototype reaches this one.
    ['audit', () => AuditService.prototype],
    ['event', () => provider<EventPort>(EVENT_PORT)],
  ])('leaves nothing behind when the %s write fails', async (_, port) => {
    const { auth, car } = await scene();
    const spy = vi
      .spyOn(port() as { record: EventPort['record'] }, 'record')
      .mockRejectedValueOnce(new Error('down'));

    try {
      const res = await post(`/cars/${car.id}/repairs`, body(), auth);
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }

    expect(await prisma.repair.count({ where: { carId: car.id } })).toBe(0);
    expect(await prisma.activityLog.count({ where: { carId: car.id } })).toBe(
      0,
    );
    // The outbox outlives the reset between cases: count this car's only.
    expect(
      await prisma.outboxEvent.count({
        where: {
          kind: 'repair.logged',
          payload: { equals: car.id, path: ['carId'] },
        },
      }),
    ).toBe(0);
  });

  it('logs the repair, car and garage ids, never the amount, text, name or plate', async () => {
    const { auth, car } = await scene();
    const garage = await world.garage('Garaj Nordic');
    const lines: string[] = [];
    const spy = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((message: unknown) => {
        lines.push(String(message));
      });

    try {
      const res = await post(
        `/cars/${car.id}/repairs`,
        body({ garageId: garage.id }),
        auth,
      );
      expect(lines).toContain(
        `repair ${res.body.id} logged on car ${car.id} at garage ${garage.id}`,
      );
    } finally {
      spy.mockRestore();
    }
    const all = lines.join('\n');
    for (const secret of ['45000', 'plăcuțe', 'Garaj Nordic', 'B123ABC']) {
      expect(all).not.toContain(secret);
    }
  });

  it('keeps who logged it after the garage corrects it', async () => {
    const { auth, car, driverId } = await scene();
    const staff = await team('Garaj Nordic');
    const res = await post(
      `/cars/${car.id}/repairs`,
      body({ garageId: staff.garage.id }),
      auth,
    );
    const saved = await prisma.repair.update({
      data: { sharedWithGarage: true },
      where: { id: res.body.id },
    });

    const corrected = await send(
      'patch',
      `/garage/client-repairs/${saved.id}`,
      bearer(staff.owner, 'garage'),
      { odometerKm: 150_000, version: saved.updatedAt.toISOString() },
    );

    expect(corrected.status).toBe(200);
    expect(
      await prisma.repair.findUniqueOrThrow({ where: { id: saved.id } }),
    ).toMatchObject({
      loggedBy: driverId,
      updatedBy: staff.owner,
      updatedByRole: 'owner',
    });
  });
});
