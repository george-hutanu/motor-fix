import { randomUUID } from 'node:crypto';

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

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const WEB = 'https://motorfix.test';
const NOON = new Date('2026-10-23T09:00:00Z');

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
        redisUrl: redisUrlFor(1),
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
  notifications.now = () => NOON;
  await reset();
});
afterEach(() => jest.restoreAllMocks());

const day = (at: Date | null) => (at ? at.toISOString().slice(0, 10) : null);
const owners = new Map<string, string>();

async function cycleDue(
  dueOn: string,
  extra: {
    status?: 'approved' | 'suspended';
    withOwner?: boolean;
    marks?: Partial<{
      reminded30At: Date;
      reminded7At: Date;
      reminded0At: Date;
    }>;
    state?: 'due' | 'overdue';
  } = {},
) {
  const garage = await prisma.garage.create({
    data: {
      approvedAt: new Date('2025-01-01T10:00:00Z'),
      name: 'Atelier',
      slug: `cycle-${randomUUID()}`,
      status: extra.status ?? 'approved',
    },
  });
  if (extra.withOwner !== false) {
    const owner = await account(`Mihai ${garage.id.slice(0, 8)}`, ['garage']);
    await prisma.garageMember.create({
      data: { accountId: owner, garageId: garage.id, role: 'owner' },
    });
    owners.set(garage.id, owner);
  }
  const file = await prisma.verificationFile.create({
    data: {
      documents: {
        create: [
          { kind: 'onrc_certificate', pages: ['p1'] },
          { kind: 'rar_authorisation', pages: ['p1'] },
        ],
      },
      garageId: garage.id,
      status: 'approved',
    },
  });
  const cycle = await prisma.documentCycle.create({
    data: {
      dueOn: new Date(dueOn),
      garageId: garage.id,
      state: extra.state ?? 'due',
      ...extra.marks,
    },
  });
  return { cycle, file, garage };
}

const cycleOf = (id: string) =>
  prisma.documentCycle.findUniqueOrThrow({ where: { id } });
const marks = async (id: string) => {
  const cycle = await cycleOf(id);
  return [cycle.reminded30At, cycle.reminded7At, cycle.reminded0At].map(
    (at) => at !== null,
  );
};
const stages = async (cycleId: string) =>
  (
    await prisma.outboxEvent.findMany({
      orderBy: { id: 'asc' },
      where: { kind: 'document.due', subjectId: cycleId },
    })
  ).map((e) => (e.payload as { stage: number }).stage);
const notices = async (garageId: string, kind: string) =>
  (
    await prisma.notification.findMany({
      where: {
        accountId: owners.get(garageId) ?? randomUUID(),
        fallbackOf: null,
        kind,
      },
    })
  )
    .map((n) => n.channel)
    .sort();

// @traces 068-FR-003
describe('the reminder windows, one day at a time', () => {
  it.each([
    ['31 days', '2026-11-23', [], [false, false, false]],
    ['30 days', '2026-11-22', [30], [true, false, false]],
    ['9 days', '2026-11-01', [30], [true, false, false]],
    ['8 days', '2026-10-31', [30], [true, false, false]],
    ['7 days', '2026-10-30', [7], [true, true, false]],
    ['2 days', '2026-10-25', [7], [true, true, false]],
    ['1 day', '2026-10-24', [7], [true, true, false]],
    ['0 days', '2026-10-23', [0], [true, true, true]],
  ] as const)(
    'with the due date %s away sends stages %j and sets marks %j',
    async (_, dueOn, sent, expectedMarks) => {
      const { cycle } = await cycleDue(dueOn);

      await step.run(NOON);

      expect(await stages(cycle.id)).toEqual(sent);
      expect(await marks(cycle.id)).toEqual(expectedMarks);
      expect(day((await cycleOf(cycle.id)).graceUntil)).toBeNull();
    },
  );

  it('turns the cycle overdue the day after, with grace to the 14th day', async () => {
    const { cycle } = await cycleDue('2026-10-22');

    await step.run(NOON);

    const after = await cycleOf(cycle.id);
    expect([after.state, day(after.graceUntil)]).toEqual([
      'overdue',
      '2026-11-05',
    ]);
    expect(await stages(cycle.id)).toEqual([]);
  });

  it('puts the grace of a leap-day due date on 14 March', async () => {
    const { cycle } = await cycleDue('2028-02-29');

    await step.run(new Date('2028-03-01T09:00:00Z'));

    expect(day((await cycleOf(cycle.id)).graceUntil)).toBe('2028-03-14');
  });

  it('crosses the year with the grace of a December due date', async () => {
    const { cycle, garage } = await cycleDue('2026-12-25');

    await step.run(new Date('2026-12-26T09:00:00Z'));

    expect(day((await cycleOf(cycle.id)).graceUntil)).toBe('2027-01-08');
    const [overdue] = await prisma.notification.findMany({
      where: { accountId: owners.get(garage.id), kind: 'DOCUMENT_OVERDUE' },
    });
    expect(overdue?.params).toMatchObject({ suspendOn: '2027-01-09' });
  });

  it('names the first of the month as the suspension day when the grace ends on the 31st', async () => {
    const { garage } = await cycleDue('2027-01-17');

    await step.run(new Date('2027-01-18T09:00:00Z'));

    const [overdue] = await prisma.notification.findMany({
      where: { accountId: owners.get(garage.id), kind: 'DOCUMENT_OVERDUE' },
    });
    expect(overdue?.params).toMatchObject({ suspendOn: '2027-02-01' });
  });

  it('grants the grace from a due date long past, not from the run day', async () => {
    const { cycle } = await cycleDue('2025-01-10');

    await step.run(NOON);

    expect(day((await cycleOf(cycle.id)).graceUntil)).toBe('2025-01-24');
  });
});

// @traces 068-FR-003
describe('the day of the run is the Bucharest day', () => {
  it('still counts the due day itself at 23:59 in Bucharest', async () => {
    const { cycle } = await cycleDue('2026-10-22');

    await step.run(new Date('2026-10-22T20:59:59Z'));

    expect((await cycleOf(cycle.id)).state).toBe('due');
    expect(await stages(cycle.id)).toEqual([0]);
  });

  it('is overdue from midnight in Bucharest, while it is still the due day in UTC', async () => {
    const { cycle } = await cycleDue('2026-10-22');

    await step.run(new Date('2026-10-22T21:00:00Z'));

    expect((await cycleOf(cycle.id)).state).toBe('overdue');
  });

  it('reminds on the due day just after midnight in winter, while it is the day before in UTC', async () => {
    const { cycle } = await cycleDue('2027-01-15');

    await step.run(new Date('2027-01-14T22:30:00Z'));

    expect(await stages(cycle.id)).toEqual([0]);
  });
});

// @traces 068-FR-003
describe('missed windows and reruns', () => {
  it('sends the 7-day reminder once after a worker down on the 8th and up on the 9th', async () => {
    const { cycle } = await cycleDue('2027-01-15');

    await step.run(new Date('2027-01-09T09:00:00Z'));
    await step.run(new Date('2027-01-09T15:00:00Z'));

    expect(await stages(cycle.id)).toEqual([7]);
    expect(await marks(cycle.id)).toEqual([true, true, false]);
  });

  it('sends only the day-0 reminder when the 30 and 7 windows both passed unseen', async () => {
    const { cycle, garage } = await cycleDue('2026-10-23');

    await step.run(NOON);
    await step.run(NOON);

    expect(await stages(cycle.id)).toEqual([0]);
    expect(await notices(garage.id, 'DOCUMENT_DUE')).toEqual([
      'email',
      'in_app',
    ]);
  });

  it('sends the three reminders across a month of daily runs, each once', async () => {
    const { cycle, garage } = await cycleDue('2027-01-15');
    for (let n = 0; n <= 37; n += 1) {
      const at = new Date(Date.UTC(2026, 11, 10 + n, 9));
      notifications.now = () => at;
      await step.run(at);
      await step.run(at);
    }

    expect(await stages(cycle.id)).toEqual([30, 7, 0]);
    expect((await cycleOf(cycle.id)).state).toBe('overdue');
    expect(await notices(garage.id, 'DOCUMENT_DUE')).toHaveLength(6);
    expect(await notices(garage.id, 'DOCUMENT_OVERDUE')).toHaveLength(2);
  });

  it('does not send the 30-day reminder again when only the 30 mark is set and 8 days remain', async () => {
    const { cycle } = await cycleDue('2026-10-31', {
      marks: { reminded30At: new Date('2026-10-01T06:00:00Z') },
    });

    await step.run(NOON);

    expect(await stages(cycle.id)).toEqual([]);
  });

  it('sends nothing on the due day once the day-0 mark is set', async () => {
    const { cycle } = await cycleDue('2026-10-23', {
      marks: {
        reminded0At: new Date('2026-10-23T06:00:00Z'),
        reminded7At: new Date('2026-10-16T06:00:00Z'),
        reminded30At: new Date('2026-09-23T06:00:00Z'),
      },
    });

    await step.run(NOON);

    expect(await stages(cycle.id)).toEqual([]);
  });

  it('writes one overdue change when three runs overlap the morning after', async () => {
    const { cycle, garage } = await cycleDue('2026-10-22');

    await Promise.all([step.run(NOON), step.run(NOON), step.run(NOON)]);

    expect(
      await prisma.outboxEvent.count({
        where: { kind: 'document.overdue', subjectId: cycle.id },
      }),
    ).toBe(1);
    expect(
      await prisma.activityLog.count({
        where: { garageId: garage.id, kind: 'documents_overdue' },
      }),
    ).toBe(1);
    expect(await notices(garage.id, 'DOCUMENT_OVERDUE')).toEqual([
      'email',
      'in_app',
    ]);
  });

  it('leaves a cycle that is not yet within 30 days untouched', async () => {
    const { cycle } = await cycleDue('2027-06-01');
    const before = await cycleOf(cycle.id);

    await step.run(NOON);

    expect(await cycleOf(cycle.id)).toEqual(before);
  });
});

// @traces 068-FR-003
describe('a document in review', () => {
  it('still gets its reminder once the document is refused, the skipped marks having stayed unset', async () => {
    const { cycle, file } = await cycleDue('2026-10-30');
    const review = await prisma.legalDocument.create({
      data: {
        kind: 'rar_authorisation',
        pages: ['p2'],
        status: 'in_review',
        verificationFileId: file.id,
      },
    });

    await step.run(NOON);
    expect(await marks(cycle.id)).toEqual([false, false, false]);

    await prisma.legalDocument.update({
      data: { status: 'refused' },
      where: { id: review.id },
    });
    await step.run(new Date('2026-10-24T09:00:00Z'));

    expect(await stages(cycle.id)).toEqual([7]);
  });

  it('sends no overdue notice later either, once the cycle turned overdue during the review', async () => {
    const { cycle, file, garage } = await cycleDue('2026-10-22');
    const review = await prisma.legalDocument.create({
      data: {
        kind: 'rar_authorisation',
        pages: ['p2'],
        status: 'in_review',
        verificationFileId: file.id,
      },
    });

    await step.run(NOON);
    await prisma.legalDocument.update({
      data: { status: 'refused' },
      where: { id: review.id },
    });
    await step.run(new Date('2026-10-24T09:00:00Z'));

    expect((await cycleOf(cycle.id)).state).toBe('overdue');
    expect(await notices(garage.id, 'DOCUMENT_OVERDUE')).toEqual([]);
  });
});

// @traces 068-FR-003
describe('the garages the step meets', () => {
  it('keeps reminding and turning overdue a suspended garage, without touching its status', async () => {
    const soon = await cycleDue('2026-10-25', { status: 'suspended' });
    const late = await cycleDue('2026-10-22', { status: 'suspended' });

    await step.run(NOON);

    expect(await stages(soon.cycle.id)).toEqual([7]);
    expect((await cycleOf(late.cycle.id)).state).toBe('overdue');
    expect(await prisma.garage.count({ where: { status: 'suspended' } })).toBe(
      2,
    );
  });

  it('moves the other cycles on when one garage has no owner left', async () => {
    const orphan = await cycleDue('2026-10-22', { withOwner: false });
    const other = await cycleDue('2026-10-22');

    await step.run(NOON).catch(() => undefined);

    expect((await cycleOf(other.cycle.id)).state).toBe('overdue');
    expect(await notices(other.garage.id, 'DOCUMENT_OVERDUE')).toEqual([
      'email',
      'in_app',
    ]);
    expect(orphan.cycle.id).not.toBe(other.cycle.id);
  });

  it('tells every owner of a garage once, each in their own language', async () => {
    const { cycle, garage } = await cycleDue('2026-10-25');
    const second = await account('Second owner', ['garage'], {
      language: 'en',
    });
    await prisma.garageMember.create({
      data: { accountId: second, garageId: garage.id, role: 'owner' },
    });

    await step.run(NOON);
    await step.run(NOON);

    const english = await prisma.notification.findMany({
      where: { accountId: second, channel: 'email', kind: 'DOCUMENT_DUE' },
    });
    expect(english).toHaveLength(1);
    expect(await stages(cycle.id)).toEqual([7]);
  });

  it('runs on an empty table', async () => {
    await expect(step.run(NOON)).resolves.toBeUndefined();
  });

  it('sends no notice to a receptionist', async () => {
    const { garage } = await cycleDue('2026-10-25');
    const staff = await account('Ana staff', ['receptionist']);
    await prisma.garageMember.create({
      data: { accountId: staff, garageId: garage.id, role: 'receptionist' },
    });

    await step.run(NOON);

    expect(
      await prisma.notification.count({ where: { accountId: staff } }),
    ).toBe(0);
  });
});
