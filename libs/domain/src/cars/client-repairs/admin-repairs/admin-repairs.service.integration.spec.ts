import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';

import {
  adminRepairsApp,
  list,
  missing,
  one,
  version,
} from './admin-repairs.testing';
import { AUDIT_PORT, type AuditPort } from '../../../audit/audit.port';
import { EVENT_PORT, type EventPort } from '../../../events/event.port';

// @traces 1267-FR-004 1267-FR-007 1267-FR-008 1267-FR-010 1267-FR-014

const { closeOwnership, get, prisma, provider, reread, scene, send } =
  adminRepairsApp();

const reader = countedMetrics();
const corrections = (outcome: string) =>
  counterTotal(reader, 'motorfix_repair_corrections_total', {
    by: 'admin',
    outcome,
  });

const entries = (subjectId: string) =>
  prisma.activityLog.findMany({
    orderBy: [{ createdAt: 'asc' }, { field: 'asc' }],
    where: { subjectId },
  });
const events = (subjectId: string) =>
  prisma.outboxEvent.findMany({
    where: { kind: 'repair.updated', subjectId },
  });

afterEach(() => jest.restoreAllMocks());

describe('opening a repair as the admin', () => {
  it('records one open entry per read, naming the admin, the car and the shared garage, and no values', async () => {
    const s = await scene();
    const row = await s.repair();

    await get(one(row.id), s.auth.admin).expect(200);
    await get(one(row.id), s.auth.admin).expect(200);

    const logged = await entries(row.id);
    expect(logged).toHaveLength(2);
    for (const entry of logged) {
      expect(entry).toMatchObject({
        action: 'open',
        actorId: s.adminId,
        actorRole: 'admin',
        carId: s.car.id,
        field: null,
        garageId: s.garage.id,
        newValue: null,
        oldValue: null,
        subjectId: row.id,
        subjectType: 'repair',
      });
    }
  });

  it('leaves the garage off the entry when the repair is not shared with it', async () => {
    const s = await scene();
    const row = await s.repair({ shared: false });

    await get(one(row.id), s.auth.admin).expect(200);

    const [entry] = await entries(row.id);
    expect(entry).toMatchObject({ action: 'open', garageId: null });
  });

  it('records nothing for a repair it cannot open, nor for the list', async () => {
    const s = await scene();
    const row = await s.repair();
    const deleted = await s.repair({ deletedAt: new Date() });

    await get(one(deleted.id), s.auth.admin).expect(404);
    await get(one(missing), s.auth.admin).expect(404);
    await get(list(s.driverId), s.auth.admin).expect(200);
    await get(one(row.id), s.auth.owner).expect(404);

    expect(await entries(row.id)).toEqual([]);
    expect(await entries(deleted.id)).toEqual([]);
  });

  it('answers no content when the open cannot be recorded', async () => {
    const s = await scene();
    const row = await s.repair();
    jest
      .spyOn(provider<AuditPort>(AUDIT_PORT), 'record')
      .mockRejectedValueOnce(new Error('audit down'));

    const res = await get(one(row.id), s.auth.admin);

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('Schimb ulei');
    expect(await entries(row.id)).toEqual([]);
  });
});

describe('correcting a repair as the admin', () => {
  it('writes one update entry per changed field as the admin, with the car and the shared garage', async () => {
    const s = await scene();
    const row = await s.repair();

    await send('patch', one(row.id), s.auth.admin, {
      costBani: null,
      odometerKm: 150_000,
      version: version(row),
    }).expect(200);

    const logged = await entries(row.id);
    expect(
      logged.map((e) => [e.field, e.oldValue, e.newValue, e.action]),
    ).toEqual([
      ['costBani', 45_000, null, 'update'],
      ['odometerKm', 151_000, 150_000, 'update'],
    ]);
    for (const entry of logged) {
      expect(entry).toMatchObject({
        actorId: s.adminId,
        actorRole: 'admin',
        carId: s.car.id,
        garageId: s.garage.id,
      });
    }
    expect(await reread(row.id)).toMatchObject({
      updatedBy: s.adminId,
      updatedByRole: 'admin',
    });
  });

  it('records repair.updated by the admin for the owner and the garage it is shared with', async () => {
    const s = await scene();
    const row = await s.repair();

    await send('patch', one(row.id), s.auth.admin, {
      doneOn: '2026-09-30',
      version: version(row),
    }).expect(200);

    const [event, ...more] = await events(row.id);
    expect(more).toEqual([]);
    expect(event?.payload).toEqual({
      by: 'admin',
      carId: s.car.id,
      changed: ['doneOn'],
      garageId: s.garage.id,
      ownerId: s.driverId,
      repairId: row.id,
    });
    expect(event?.audience).toEqual([
      `account:${s.driverId}`,
      `garage:${s.garage.id}`,
    ]);
  });

  it('tells only the owner, and names no garage in the entries, for a repair not shared', async () => {
    const s = await scene();
    const row = await s.repair({ shared: false });

    await send('patch', one(row.id), s.auth.admin, {
      odometerKm: 150_000,
      version: version(row),
    }).expect(200);

    const [entry] = await entries(row.id);
    expect(entry).toMatchObject({ field: 'odometerKm', garageId: null });
    const [event] = await events(row.id);
    expect(event?.audience).toEqual([`account:${s.driverId}`]);
    expect(event?.payload).toMatchObject({ by: 'admin', ownerId: s.driverId });
  });

  it('records repair.updated with no owner for a car whose owner sold it', async () => {
    const s = await scene();
    const row = await s.repair({ shared: false });
    await closeOwnership(s.car.id);

    await send('patch', one(row.id), s.auth.admin, {
      odometerKm: 150_000,
      version: version(row),
    }).expect(200);

    const [event] = await events(row.id);
    expect(event?.payload).toMatchObject({ ownerId: null });
    expect(event?.audience).toEqual([]);
  });

  it('leaves nothing behind when the event cannot be recorded', async () => {
    const s = await scene();
    const row = await s.repair();
    jest
      .spyOn(provider<EventPort>(EVENT_PORT), 'record')
      .mockRejectedValueOnce(new Error('outbox down'));

    const res = await send('patch', one(row.id), s.auth.admin, {
      odometerKm: 150_000,
      version: version(row),
    });

    expect(res.status).toBe(500);
    expect(await reread(row.id)).toMatchObject({
      odometerKm: 151_000,
      updatedAt: row.updatedAt,
    });
    expect(await entries(row.id)).toEqual([]);
  });

  it('counts each outcome as the admin’s', async () => {
    const s = await scene();
    const row = await s.repair();
    const before = {
      corrected: await corrections('corrected'),
      not_found: await corrections('not_found'),
      stale: await corrections('stale'),
      unchanged: await corrections('unchanged'),
    };

    await send('patch', one(row.id), s.auth.admin, {
      version: version(row),
    }).expect(200);
    await send('patch', one(row.id), s.auth.admin, {
      odometerKm: 150_000,
      version: version(row),
    }).expect(200);
    await send('patch', one(row.id), s.auth.admin, {
      odometerKm: 149_000,
      version: version(row),
    }).expect(409);
    await send('patch', one(missing), s.auth.admin, {
      version: version(row),
    }).expect(404);

    expect(await corrections('unchanged')).toBe(before.unchanged + 1);
    expect(await corrections('corrected')).toBe(before.corrected + 1);
    expect(await corrections('stale')).toBe(before.stale + 1);
    expect(await corrections('not_found')).toBe(before.not_found + 1);
  });

  it('logs that an admin made the correction, naming the fields', async () => {
    const s = await scene();
    const row = await s.repair();
    const log = jest.spyOn(Logger.prototype, 'log');

    await send('patch', one(row.id), s.auth.admin, {
      odometerKm: 150_000,
      version: version(row),
      what: 'Schimb ulei și filtre',
    }).expect(200);

    expect(log).toHaveBeenCalledWith(
      `repair ${row.id} corrected by admin: what, odometerKm`,
    );
  });
});
