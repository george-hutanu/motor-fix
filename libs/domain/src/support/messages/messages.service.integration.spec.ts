import type { CreateSupportMessageDto } from '@motor-fix/contracts';

import { SupportMessagesService } from './messages.service';
import type { Actor } from '../../auth/policy';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outbox } from '../../events/event.port';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

// @traces 280-FR-006 280-FR-014 280-FR-022

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};

const person = (accountId: string, role: Actor['role']): Actor => ({
  accountId,
  garageId: null,
  permissions: NONE,
  role,
  roles: [role],
});

const body = (
  over: Partial<CreateSupportMessageDto> = {},
): CreateSupportMessageDto => ({
  email: 'ana@example.test',
  language: 'ro',
  message: 'Nu pot vedea cererea trimisă ieri.',
  name: 'Ana Pop',
  topic: 'account',
  ...over,
});

const service = () => new SupportMessagesService(prisma, outbox);

// 2026-12-31 23:30 in Bucharest is still 2026; 22:30 UTC is 00:30 there.
const LATE_2026 = new Date('2026-12-31T21:30:00Z');
const EARLY_2027 = new Date('2026-12-31T22:30:00Z');

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe(
    'TRUNCATE support_message, support_reference, outbox_event',
  );
});

afterAll(() => prisma.$disconnect());

describe('storing a support message', () => {
  it('stores a visitor’s message with its event, ids only, for the admins', async () => {
    const { id, reference } = await service().create(
      undefined,
      body({ subjectRef: 'req-42' }),
      LATE_2026,
    );

    const row = await prisma.supportMessage.findUniqueOrThrow({
      where: { id },
    });
    expect(row).toMatchObject({
      accountId: null,
      acknowledgementStatus: 'pending',
      email: 'ana@example.test',
      language: 'ro',
      message: 'Nu pot vedea cererea trimisă ieri.',
      name: 'Ana Pop',
      reference,
      role: 'visitor',
      subjectRef: 'req-42',
      supportEmailStatus: 'pending',
      topic: 'account',
    });
    const events = await prisma.outboxEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'support.message_received',
      payload: { id },
      subjectId: id,
    });
  });

  it('numbers the references per Bucharest year, from 1', async () => {
    const first = await service().create(undefined, body(), LATE_2026);
    const second = await service().create(undefined, body(), LATE_2026);
    const next = await service().create(undefined, body(), EARLY_2027);

    expect([first.reference, second.reference, next.reference]).toEqual([
      'MF-2026-000001',
      'MF-2026-000002',
      'MF-2027-000001',
    ]);
  });

  it('gives concurrent messages distinct references', async () => {
    const made = await Promise.all(
      Array.from({ length: 5 }, () =>
        service().create(undefined, body(), LATE_2026),
      ),
    );

    expect(new Set(made.map((m) => m.reference)).size).toBe(5);
  });

  it('takes the account and the role from the session', async () => {
    const driver = await account('dana', ['driver']);
    const mechanic = await account('mihai', ['mechanic']);
    const admin = await account('adi', ['admin']);

    const rows = await Promise.all(
      [
        person(driver, 'driver'),
        person(mechanic, 'mechanic'),
        person(admin, 'admin'),
      ].map(async (actor) => {
        const { id } = await service().create(actor, body(), LATE_2026);
        return prisma.supportMessage.findUniqueOrThrow({ where: { id } });
      }),
    );

    expect(rows.map((r) => [r.accountId, r.role])).toEqual([
      [driver, 'driver'],
      [mechanic, 'garage'],
      [admin, 'admin'],
    ]);
  });

  it('keeps the message when the account is deleted', async () => {
    const driver = await account('dana', ['driver']);
    const { id } = await service().create(
      person(driver, 'driver'),
      body(),
      LATE_2026,
    );

    await prisma.$executeRawUnsafe(
      'DELETE FROM account WHERE id = $1::uuid',
      driver,
    );

    const row = await prisma.supportMessage.findUniqueOrThrow({
      where: { id },
    });
    expect([row.accountId, row.role]).toEqual([null, 'driver']);
  });

  it('stores nothing when the event cannot be written', async () => {
    const failing = new SupportMessagesService(prisma, {
      record: async () => {
        throw new Error('outbox down');
      },
    });

    await expect(failing.create(undefined, body(), LATE_2026)).rejects.toThrow(
      'outbox down',
    );
    expect(await prisma.supportMessage.count()).toBe(0);
  });

  it.each([
    ['name', "''"],
    ['name', `repeat('n', 81)`],
    ['message', `repeat('x', 19)`],
    ['message', `repeat('x', 2001)`],
    ['subject_ref', `repeat('r', 41)`],
    ['language', "'de'"],
  ])('the table refuses %s = %s', async (column, value) => {
    const columns: Record<string, string> = {
      email: "'a@example.test'",
      language: "'ro'",
      message: `repeat('x', 20)`,
      name: "'Ana'",
      reference: "'MF-2026-999999'",
      role: "'visitor'",
      subject_ref: 'NULL',
      topic: "'other'",
      [column]: value,
    };

    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO support_message (${Object.keys(columns).join(', ')}) VALUES (${Object.values(columns).join(', ')})`,
      ),
    ).rejects.toThrow();
  });
});
