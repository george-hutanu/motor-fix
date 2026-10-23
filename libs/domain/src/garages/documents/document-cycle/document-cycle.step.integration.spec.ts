import { randomUUID } from 'node:crypto';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { DocumentCycleStep } from './document-cycle.step';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { NotificationsModule } from '../../../notifications/notifications.module';
import { NotificationsService } from '../../../notifications/notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../../../notifications/notifications.testing';

// @traces 068-FR-003
// @traces 068-FR-013
// @traces 068-FR-014
// @traces 068-FR-016
// @traces 068-FR-017

const reader = countedMetrics();
const counted = (step: string) =>
  counterTotal(reader, 'motorfix_document_cycle_total', { step });
const overdueGauge = () => counterTotal(reader, 'motorfix_documents_overdue');

const redisUrl = redisUrlFor(1);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

// 09:00 in Bucharest on 23 October 2026.
const NOW = new Date('2026-10-23T06:00:00Z');
const WEB = 'https://motorfix.test';

let app: TestingModule;
let notifications: NotificationsService;
let step: DocumentCycleStep;

beforeAll(async () => {
  app = await Test.createTestingModule({
    imports: [
      NotificationsModule.registerWorker({
        databaseUrl,
        email: testConfig('http://127.0.0.1:9'),
        phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
        redisUrl,
      }),
    ],
  }).compile();
  notifications = app.get(NotificationsService);
  step = new DocumentCycleStep(prisma, notifications, WEB);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  notifications.now = () => NOW;
  await reset();
});
afterEach(() => jest.restoreAllMocks());

const day = (at: Date | null) => (at ? at.toISOString().slice(0, 10) : null);

const owners = new Map<string, { owner: string; receptionist: string }>();
const ownerOf = (garageId: string) => owners.get(garageId)?.owner ?? '';

async function cycleDue(
  dueOn: string,
  extra: {
    state?: 'due' | 'overdue';
    reminded30At?: Date;
    inReview?: boolean;
  } = {},
) {
  const garage = await prisma.garage.create({
    data: {
      approvedAt: new Date('2025-10-01T10:00:00Z'),
      name: 'Atelier',
      slug: `cycle-${randomUUID()}`,
      status: 'approved',
    },
  });
  const tag = garage.id.slice(0, 8);
  const owner = await account(`Mihai ${tag}`, ['garage']);
  const receptionist = await account(`Ana ${tag}`, ['receptionist']);
  await prisma.garageMember.createMany({
    data: [
      { accountId: owner, garageId: garage.id, role: 'owner' },
      { accountId: receptionist, garageId: garage.id, role: 'receptionist' },
    ],
  });
  owners.set(garage.id, { owner, receptionist });
  await prisma.verificationFile.create({
    data: {
      documents: {
        create: [
          { kind: 'onrc_certificate', pages: ['p1'] },
          { kind: 'rar_authorisation', pages: ['p1'] },
          ...(extra.inReview
            ? [
                {
                  kind: 'rar_authorisation',
                  pages: ['p2'],
                  status: 'in_review',
                },
              ]
            : []),
        ],
      },
      garageId: garage.id,
      status: 'approved',
    },
  });
  return prisma.documentCycle.create({
    data: {
      dueOn: new Date(dueOn),
      garageId: garage.id,
      reminded30At: extra.reminded30At,
      state: extra.state ?? 'due',
    },
  });
}

const cycleOf = (id: string) =>
  prisma.documentCycle.findUniqueOrThrow({ where: { id } });
const marks = async (id: string) => {
  const cycle = await cycleOf(id);
  return [cycle.reminded30At, cycle.reminded7At, cycle.reminded0At].map(
    (at) => at !== null,
  );
};
const events = (subjectId: string, kind?: string) =>
  prisma.outboxEvent.findMany({
    orderBy: { id: 'asc' },
    where: { subjectId, ...(kind && { kind }) },
  });

// By channel name: the enum's own order is not the alphabet's.
const notices = async (accountId: string, kind?: string) =>
  (
    await prisma.notification.findMany({
      where: { accountId, fallbackOf: null, ...(kind && { kind }) },
    })
  ).sort((a, b) => a.channel.localeCompare(b.channel));

describe('the daily compliance step', () => {
  it('sends the 30-day reminder once from 30 days before the due date', async () => {
    const cycle = await cycleDue('2026-11-22');
    const before = await counted('reminded_30');

    await step.run(NOW);
    await step.run(new Date('2026-10-23T14:00:00Z'));

    expect(await marks(cycle.id)).toEqual([true, false, false]);
    const due = await events(cycle.id);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      audience: ['admin', `garage:${cycle.garageId}`],
      kind: 'document.due',
      payload: { dueOn: '2026-11-22', garageId: cycle.garageId, stage: 30 },
    });
    expect((await counted('reminded_30')) - before).toBe(1);
  });

  it('sends nothing 31 days before the due date', async () => {
    const cycle = await cycleDue('2026-11-23');

    await step.run(NOW);

    expect(await marks(cycle.id)).toEqual([false, false, false]);
    expect(await events(cycle.id)).toEqual([]);
  });

  it('sends the 30-day reminder up to 8 days before and the 7-day one from 7 days', async () => {
    const eight = await cycleDue('2026-10-31');
    const seven = await cycleDue('2026-10-30', {
      reminded30At: new Date('2026-10-01T06:00:00Z'),
    });

    await step.run(NOW);

    expect((await events(eight.id)).map((e) => e.payload)).toEqual([
      { dueOn: '2026-10-31', garageId: eight.garageId, stage: 30 },
    ]);
    expect((await events(seven.id)).map((e) => e.payload)).toEqual([
      { dueOn: '2026-10-30', garageId: seven.garageId, stage: 7 },
    ]);
    expect(await marks(seven.id)).toEqual([true, true, false]);
  });

  it('sends only the latest missed reminder, marking the earlier ones silently', async () => {
    const week = await cycleDue('2026-10-25');
    const today = await cycleDue('2026-10-23');

    await step.run(NOW);

    expect((await events(week.id)).map((e) => e.payload)).toEqual([
      { dueOn: '2026-10-25', garageId: week.garageId, stage: 7 },
    ]);
    expect(await marks(week.id)).toEqual([true, true, false]);
    expect((await events(today.id)).map((e) => e.payload)).toEqual([
      { dueOn: '2026-10-23', garageId: today.garageId, stage: 0 },
    ]);
    expect(await marks(today.id)).toEqual([true, true, true]);
  });

  it('writes each reminder once when two runs overlap', async () => {
    const cycle = await cycleDue('2026-10-25');
    const before = await counted('reminded_7');

    await Promise.all([step.run(NOW), step.run(NOW), step.run(NOW)]);

    expect(await events(cycle.id)).toHaveLength(1);
    expect((await counted('reminded_7')) - before).toBe(1);
  });

  it('turns the cycle overdue the day after its due date, with 14 days of grace, its history and its event', async () => {
    const cycle = await cycleDue('2026-10-22');
    const before = await counted('overdue');

    await step.run(NOW);

    const after = await cycleOf(cycle.id);
    expect([after.state, day(after.graceUntil)]).toEqual([
      'overdue',
      '2026-11-05',
    ]);
    const history = await prisma.activityLog.findMany({
      where: { garageId: cycle.garageId, kind: 'documents_overdue' },
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      action: 'update',
      actorId: null,
      actorName: 'MotorFix',
      actorRole: 'system',
      field: 'documents_state',
      newValue: { graceUntil: '2026-11-05', state: 'overdue' },
      oldValue: { state: 'due' },
      subjectId: cycle.garageId,
      subjectType: 'garage',
    });
    const overdue = await events(cycle.id, 'document.overdue');
    expect(overdue).toHaveLength(1);
    expect(overdue[0]).toMatchObject({
      audience: ['admin', `garage:${cycle.garageId}`],
      payload: {
        dueOn: '2026-10-22',
        garageId: cycle.garageId,
        graceUntil: '2026-11-05',
      },
    });
    expect(await events(cycle.id, 'document.due')).toEqual([]);
    expect((await counted('overdue')) - before).toBe(1);
  });

  it('never suspends the garage, and changes nothing on a second run', async () => {
    const cycle = await cycleDue('2026-10-10');

    await step.run(NOW);
    const first = await cycleOf(cycle.id);
    await step.run(new Date('2026-10-24T06:00:00Z'));

    expect(await cycleOf(cycle.id)).toEqual(first);
    expect(day(first.graceUntil)).toBe('2026-10-24');
    expect(await events(cycle.id)).toHaveLength(1);
    expect(
      await prisma.garageSuspension.count({
        where: { garageId: cycle.garageId },
      }),
    ).toBe(0);
    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: cycle.garageId },
    });
    expect(garage.status).toBe('approved');
  });

  it('sends no reminder once the cycle is overdue', async () => {
    const cycle = await cycleDue('2026-10-10', { state: 'overdue' });

    await step.run(NOW);

    expect(await events(cycle.id)).toEqual([]);
    expect(await marks(cycle.id)).toEqual([false, false, false]);
  });

  it('sends no reminder while a document is in review, but still turns the cycle overdue', async () => {
    const waiting = await cycleDue('2026-10-25', { inReview: true });
    const late = await cycleDue('2026-10-22', { inReview: true });

    await step.run(NOW);

    expect(await events(waiting.id)).toEqual([]);
    expect(await marks(waiting.id)).toEqual([false, false, false]);
    const after = await cycleOf(late.id);
    expect([after.state, day(after.graceUntil)]).toEqual([
      'overdue',
      '2026-11-05',
    ]);
    expect(await events(late.id, 'document.due')).toEqual([]);
    expect(await events(late.id, 'document.overdue')).toHaveLength(1);
  });

  it('reports the overdue cycles and logs one line for the run', async () => {
    const log = jest.spyOn(Logger.prototype, 'log');
    await cycleDue('2026-10-01', { state: 'overdue' });
    await cycleDue('2026-10-22');
    await cycleDue('2026-11-20');

    await step.run(NOW);

    expect(await overdueGauge()).toBe(2);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      '2026-10-23: reminders 30=1 7=0 0=0, overdue 1',
    );
  });
});

describe('the notices the compliance step sends', () => {
  it('sends DOCUMENT_DUE to the owner alone, keyed by its stage, with the due date and the dashboard', async () => {
    const cycle = await cycleDue('2026-11-22');
    const { owner, receptionist } = owners.get(cycle.garageId) ?? {};

    await step.run(NOW);
    await step.run(new Date('2026-10-23T14:00:00Z'));

    const sent = await notices(owner ?? '');
    expect(sent.map((n) => [n.kind, n.channel])).toEqual([
      ['DOCUMENT_DUE', 'email'],
      ['DOCUMENT_DUE', 'in_app'],
    ]);
    for (const notice of sent) {
      expect(notice).toMatchObject({
        eventId: `document-30-${cycle.garageId}-2026-11-22`,
        subjectId: cycle.garageId,
      });
    }
    expect(sent[0].params).toEqual({
      dashboard: `${WEB}/app/garage`,
      dueOn: '2026-11-22',
    });
    expect(await notices(receptionist ?? '')).toEqual([]);
  });

  it('sends one DOCUMENT_DUE per stage reached, across overlapping runs', async () => {
    const week = await cycleDue('2026-10-25');
    const today = await cycleDue('2026-10-23');

    await Promise.all([step.run(NOW), step.run(NOW), step.run(NOW)]);

    expect(
      (await notices(ownerOf(week.garageId), 'DOCUMENT_DUE')).map(
        (n) => n.eventId,
      ),
    ).toEqual([
      `document-7-${week.garageId}-2026-10-25`,
      `document-7-${week.garageId}-2026-10-25`,
    ]);
    expect(
      (await notices(ownerOf(today.garageId), 'DOCUMENT_DUE')).map(
        (n) => n.eventId,
      ),
    ).toEqual([
      `document-0-${today.garageId}-2026-10-23`,
      `document-0-${today.garageId}-2026-10-23`,
    ]);
  });

  it('sends DOCUMENT_OVERDUE once, naming the day after the grace as the suspension day', async () => {
    const cycle = await cycleDue('2026-10-22');

    await step.run(NOW);
    await step.run(new Date('2026-10-24T06:00:00Z'));

    const sent = await notices(ownerOf(cycle.garageId));
    expect(sent.map((n) => [n.kind, n.channel])).toEqual([
      ['DOCUMENT_OVERDUE', 'email'],
      ['DOCUMENT_OVERDUE', 'in_app'],
    ]);
    expect(sent[0]).toMatchObject({
      eventId: `document-overdue-${cycle.garageId}-2026-10-22`,
      params: {
        dashboard: `${WEB}/app/garage`,
        dueOn: '2026-10-22',
        suspendOn: '2026-11-06',
      },
    });
  });

  it('sends the e-mail whatever the owner muted', async () => {
    const cycle = await cycleDue('2026-11-22');
    const owner = ownerOf(cycle.garageId);
    await prisma.notificationPreference.createMany({
      data: (['email', 'push'] as const).map((channel) => ({
        accountId: owner,
        channel,
        enabled: false,
        garageId: cycle.garageId,
        type: 'DOCUMENT_DUE',
      })),
    });

    await step.run(NOW);

    expect((await notices(owner)).map((n) => n.channel)).toEqual([
      'email',
      'in_app',
    ]);
  });

  it('holds a notice built in quiet hours until 08:00', async () => {
    const cycle = await cycleDue('2026-10-22');
    // 23:30 in Bucharest.
    const night = new Date('2026-10-23T20:30:00Z');
    notifications.now = () => night;

    await step.run(night);

    const email = (await notices(ownerOf(cycle.garageId))).find(
      (n) => n.channel === 'email',
    );
    expect(email?.status).toBe('held');
    expect(email?.sendAfter?.toISOString()).toBe('2026-10-24T05:00:00.000Z');
  });

  it('sends nothing while a document is in review', async () => {
    const waiting = await cycleDue('2026-10-25', { inReview: true });
    const late = await cycleDue('2026-10-22', { inReview: true });

    await step.run(NOW);

    expect(await notices(ownerOf(waiting.garageId))).toEqual([]);
    expect(await notices(ownerOf(late.garageId))).toEqual([]);
  });

  it('sends nothing once the cycle is overdue', async () => {
    const cycle = await cycleDue('2026-10-10', { state: 'overdue' });

    await step.run(NOW);

    expect(await notices(ownerOf(cycle.garageId))).toEqual([]);
  });

  // The notice commits on its own; the cycle's change after it is lost.
  const loseTheCommitAfterTheNotice = () => {
    const notify = notifications.notify.bind(notifications);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest
      .spyOn(notifications, 'notify')
      .mockImplementationOnce(async (input) => {
        await notify(input);
        throw new Error('commit lost');
      });
  };

  it('sends DOCUMENT_DUE once per channel when the run after a lost commit sends it again', async () => {
    const cycle = await cycleDue('2026-11-22');
    loseTheCommitAfterTheNotice();

    await expect(step.run(NOW)).rejects.toThrow('commit lost');
    expect(await marks(cycle.id)).toEqual([false, false, false]);
    await step.run(NOW);

    expect(await marks(cycle.id)).toEqual([true, false, false]);
    const sent = await notices(ownerOf(cycle.garageId));
    expect(sent.map((n) => [n.kind, n.channel, n.eventId])).toEqual([
      ['DOCUMENT_DUE', 'email', `document-30-${cycle.garageId}-2026-11-22`],
      ['DOCUMENT_DUE', 'in_app', `document-30-${cycle.garageId}-2026-11-22`],
    ]);
  });

  it('sends DOCUMENT_OVERDUE once per channel when the run after a lost commit sends it again', async () => {
    const cycle = await cycleDue('2026-10-22');
    loseTheCommitAfterTheNotice();

    await expect(step.run(NOW)).rejects.toThrow('commit lost');
    expect((await cycleOf(cycle.id)).state).toBe('due');
    await step.run(NOW);

    expect((await cycleOf(cycle.id)).state).toBe('overdue');
    expect(
      (await notices(ownerOf(cycle.garageId))).map((n) => [n.kind, n.channel]),
    ).toEqual([
      ['DOCUMENT_OVERDUE', 'email'],
      ['DOCUMENT_OVERDUE', 'in_app'],
    ]);
  });
});
