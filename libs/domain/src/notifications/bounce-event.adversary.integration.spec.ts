import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { BrevoMock } from './brevo/brevo-mock.testing';
import { NotificationsService } from './notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from './notifications.testing';
import { AuditService } from '../audit/audit.service';
import { serialDatabase } from '../auth/serial-db.testing';

const redisUrl = redisUrlFor(3);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const mock = new BrevoMock();
const queue = new Queue('notifications', { connection: { url: redisUrl } });
const publisher = new Redis(redisUrl);
const pushConfig = {
  privateKey: 'private',
  publicKey: 'public',
  subject: 'mailto:ops@example.test',
};
const DAY = '2026-10-05T11:00:00Z';
const LATER = '2026-10-06T11:00:00Z';

let service: NotificationsService;

beforeAll(async () => {
  await mock.start();
});

afterAll(async () => {
  await queue.close();
  publisher.disconnect();
  await mock.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await queue.obliterate({ force: true });
  service = new NotificationsService(
    prisma,
    queue,
    publisher,
    testConfig(mock.url),
    pushConfig,
    new AuditService(),
  );
  service.now = () => new Date(DAY);
});

afterEach(async () => {
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS refuse_bounce_event ON outbox_event',
  );
  await prisma.$executeRawUnsafe(
    'DROP FUNCTION IF EXISTS refuse_bounce_event()',
  );
});

const quote = (recipient: string, eventId: string) =>
  service.notify({
    eventId,
    kind: 'QUOTE_RECEIVED',
    params: {},
    recipients: [recipient],
    subjectId: '6d1f6a9c-1b7e-4a52-9a5b-1c1a2e3f4a5b',
  });

const emailRows = (accountId: string) =>
  prisma.notification.findMany({
    orderBy: { createdAt: 'asc' },
    where: { accountId, channel: 'email' },
  });

const sentEmail = async (accountId: string, eventId: string, id: string) => {
  await quote(accountId, eventId);
  const row = (await emailRows(accountId)).find(
    (r) => r.status !== 'failed' && r.providerMessageId === null,
  );
  await prisma.notification.update({
    data: { providerMessageId: id, status: 'sent' },
    where: { id: row?.id },
  });
  return row?.id as string;
};

const events = (accountId: string) =>
  prisma.outboxEvent.count({
    where: { kind: 'account.updated', subjectId: accountId },
  });
const audits = (accountId: string) =>
  prisma.activityLog.count({
    where: { field: 'emailBouncedAt', subjectId: accountId },
  });
const mark = async (accountId: string) =>
  (await prisma.account.findUnique({ where: { id: accountId } }))
    ?.emailBouncedAt;

describe('a hard bounce at its edges', () => {
  // @traces 525-bounce-domain-event-FR-001
  it('rolls the mark, the audit entry and the event back together when the event cannot be written, and records in full on the next report', async () => {
    const andrei = await account('andrei');
    const rowId = await sentEmail(andrei, 'evt-1', '<r@relay>');
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION refuse_bounce_event() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'outbox down'; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER refuse_bounce_event BEFORE INSERT ON outbox_event
      FOR EACH ROW EXECUTE FUNCTION refuse_bounce_event()`);

    await expect(service.recordBounce('<r@relay>')).rejects.toThrow();

    expect(await mark(andrei)).toBeNull();
    expect(await audits(andrei)).toBe(0);
    expect(await events(andrei)).toBe(0);
    expect(
      await prisma.notification.findUnique({ where: { id: rowId } }),
    ).toMatchObject({ status: 'sent' });

    await prisma.$executeRawUnsafe(
      'DROP TRIGGER refuse_bounce_event ON outbox_event',
    );
    await service.recordBounce('<r@relay>');

    expect(await mark(andrei)).toEqual(new Date(DAY));
    expect(await audits(andrei)).toBe(1);
    expect(await events(andrei)).toBe(1);
    expect(
      await prisma.notification.findUnique({ where: { id: rowId } }),
    ).toMatchObject({ failure: 'bounced', status: 'failed' });
  });

  // @traces 525-bounce-domain-event-FR-002
  it('writes one event and one audit entry for a grouped e-mail of three rows', async () => {
    const andrei = await account('andrei');
    await quote(andrei, 'evt-1');
    await quote(andrei, 'evt-2');
    await quote(andrei, 'evt-3');
    await prisma.notification.updateMany({
      data: { providerMessageId: '<g@relay>', status: 'sent' },
      where: { accountId: andrei, channel: 'email' },
    });

    await service.recordBounce('<g@relay>');

    expect(await events(andrei)).toBe(1);
    expect(await audits(andrei)).toBe(1);
    expect(
      await prisma.notification.count({
        where: { accountId: andrei, channel: 'email', status: 'failed' },
      }),
    ).toBe(3);
  });

  // @traces 525-bounce-domain-event-FR-002
  it('still records when one row of the message is already failed and another is sent', async () => {
    const andrei = await account('andrei');
    await quote(andrei, 'evt-1');
    await quote(andrei, 'evt-2');
    const [first] = await emailRows(andrei);
    await prisma.notification.updateMany({
      data: { providerMessageId: '<m@relay>', status: 'sent' },
      where: { accountId: andrei, channel: 'email' },
    });
    await prisma.notification.update({
      data: { failure: 'bounced', status: 'failed' },
      where: { id: first.id },
    });

    await service.recordBounce('<m@relay>');

    expect(await events(andrei)).toBe(1);
    expect(await mark(andrei)).toEqual(new Date(DAY));
  });

  // @traces 525-bounce-domain-event-FR-002
  it('writes nothing when every row of the message already failed for another reason', async () => {
    const andrei = await account('andrei');
    await quote(andrei, 'evt-1');
    await prisma.notification.updateMany({
      data: {
        failure: 'provider_error',
        providerMessageId: '<f@relay>',
        status: 'failed',
      },
      where: { accountId: andrei, channel: 'email' },
    });

    await service.recordBounce('<f@relay>');

    expect(await events(andrei)).toBe(0);
    expect(await audits(andrei)).toBe(0);
    expect(await mark(andrei)).toBeNull();
  });

  // @traces 525-bounce-domain-event-FR-002
  it('claims nothing for an empty message id even though other rows carry no id', async () => {
    const andrei = await account('andrei');
    await quote(andrei, 'evt-1');

    await service.recordBounce('');

    expect(await events(andrei)).toBe(0);
    expect(await mark(andrei)).toBeNull();
    expect(
      await prisma.notification.count({
        where: { accountId: andrei, status: 'failed' },
      }),
    ).toBe(0);
  });

  // @traces 525-bounce-domain-event-FR-002
  it('does not match a message id that differs by whitespace, case or unicode', async () => {
    const andrei = await account('andrei');
    await sentEmail(andrei, 'evt-1', '<Abc@relay>');

    await service.recordBounce('<Abc@relay> ');
    await service.recordBounce('<abc@relay>');
    await service.recordBounce('<Abc@rélay>');

    expect(await events(andrei)).toBe(0);
    expect(await mark(andrei)).toBeNull();
  });

  // @traces 525-bounce-domain-event-FR-002
  it('treats a message id with SQL metacharacters as plain text', async () => {
    const andrei = await account('andrei');
    await sentEmail(andrei, 'evt-1', '<x@relay>');

    await service.recordBounce("' OR '1'='1");
    await service.recordBounce('%');

    expect(await events(andrei)).toBe(0);
    expect(await mark(andrei)).toBeNull();
  });

  // @traces 525-bounce-domain-event-FR-002
  it('records once under twenty simultaneous reports of one message', async () => {
    const andrei = await account('andrei');
    await sentEmail(andrei, 'evt-1', '<c@relay>');

    await Promise.all(
      Array.from({ length: 20 }, () => service.recordBounce('<c@relay>')),
    );

    expect(await events(andrei)).toBe(1);
    expect(await audits(andrei)).toBe(1);
  });

  // @traces 525-bounce-domain-event-FR-002
  it('records two events when two different messages to one account bounce together', async () => {
    const andrei = await account('andrei');
    await sentEmail(andrei, 'evt-1', '<a@relay>');
    await sentEmail(andrei, 'evt-2', '<b@relay>');

    await Promise.all([
      service.recordBounce('<a@relay>'),
      service.recordBounce('<b@relay>'),
    ]);

    expect(await events(andrei)).toBe(2);
    expect(await audits(andrei)).toBe(2);
  });

  // @traces 525-bounce-domain-event-FR-002
  it('moves the mark to the later time when a second message bounces', async () => {
    const andrei = await account('andrei');
    await sentEmail(andrei, 'evt-1', '<a@relay>');
    await sentEmail(andrei, 'evt-2', '<b@relay>');
    await service.recordBounce('<a@relay>');
    service.now = () => new Date(LATER);

    await service.recordBounce('<b@relay>');

    expect(await mark(andrei)).toEqual(new Date(LATER));
    expect(await events(andrei)).toBe(2);
  });

  // @traces 525-bounce-domain-event-FR-001
  it('writes the event for the account that owns the message and for no other account', async () => {
    const andrei = await account('andrei');
    const maria = await account('maria');
    await sentEmail(andrei, 'evt-1', '<a@relay>');
    await sentEmail(maria, 'evt-2', '<b@relay>');

    await service.recordBounce('<a@relay>');

    expect(await events(andrei)).toBe(1);
    expect(await events(maria)).toBe(0);
    expect(await mark(maria)).toBeNull();
  });

  // @traces 525-bounce-domain-event-FR-002
  it('ignores a bell row that carries the same provider id', async () => {
    const andrei = await account('andrei');
    await quote(andrei, 'evt-1');
    await prisma.notification.updateMany({
      data: { providerMessageId: '<p@relay>', status: 'sent' },
      where: { accountId: andrei, channel: 'in_app' },
    });

    await service.recordBounce('<p@relay>');

    expect(await events(andrei)).toBe(0);
    expect(await mark(andrei)).toBeNull();
  });
});
