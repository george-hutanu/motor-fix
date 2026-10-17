import type { CreateSupportMessageDto } from '@motor-fix/contracts';
import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';

import { supportMessagesConsumer } from './delivery.consumer';
import { SupportDelivery } from './delivery.handler';
import { countUnsent, observeUnsent } from './gauge';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outbox } from '../../events/event.port';
import { Brevo } from '../../notifications/brevo/brevo';
import { BrevoMock } from '../../notifications/brevo/brevo-mock.testing';
import type { EmailConfig } from '../../notifications/email-config';
import {
  databaseUrl,
  fixtures,
  testConfig,
} from '../../notifications/notifications.testing';
import { SupportMessagesService } from '../messages/messages.service';
import type { SupportConfig } from '../support-config';

// @traces 280-FR-015 280-FR-016 280-FR-017 280-FR-021 280-FR-022

const reader = countedMetrics();
const emails = (kind: string, outcome: string) =>
  counterTotal(reader, 'motorfix_support_emails_total', { kind, outcome });

const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const mock = new BrevoMock();
const SUPPORT = 'support@example.test';
const NOW = new Date('2026-10-17T09:00:00Z');

let email: EmailConfig;
const brevo = () => new Brevo({ apiKey: 'test-key', apiUrl: mock.url });
const delivery = (
  support: SupportConfig = { email: SUPPORT },
  config: EmailConfig = email,
) => new SupportDelivery(prisma, brevo(), config, support, () => NOW);

const body = (
  over: Partial<CreateSupportMessageDto> = {},
): CreateSupportMessageDto => ({
  email: 'ana@example.test',
  language: 'en',
  message: 'I cannot see the request I sent yesterday.',
  name: 'Ana Pop',
  topic: 'account',
  ...over,
});

const store = async (over: Partial<CreateSupportMessageDto> = {}) =>
  new SupportMessagesService(prisma, outbox).create(undefined, body(over), NOW);

// The e-mails Brevo was asked to send, in order.
interface SentEmail {
  subject: string;
  textContent: string;
  to: { email: string; name?: string }[];
}
const sent = () => mock.emails().map((call) => call.body as SentEmail);

const job = (id: string) => ({ data: { id: 'event', payload: { id } } });

const row = (id: string) =>
  prisma.supportMessage.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  await mock.start();
  email = testConfig(mock.url);
});

afterAll(async () => {
  await mock.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  mock.reset();
  await reset();
  await prisma.$executeRawUnsafe(
    'TRUNCATE support_message, support_reference, outbox_event',
  );
});

describe('delivering a support message', () => {
  it('sends the support e-mail and the acknowledgement, and records both', async () => {
    const { id, reference } = await store({ subjectRef: 'req-42' });
    const sentBefore = await emails('support', 'sent');

    await delivery().handle(job(id));

    const [toSupport, toSender] = sent();
    expect(toSupport).toMatchObject({
      replyTo: { email: 'ana@example.test', name: 'Ana Pop' },
      sender: { email: 'noreply@example.test' },
      subject: `[${reference}] Contul meu: Ana Pop`,
      to: [{ email: SUPPORT }],
    });
    expect(toSupport.textContent).toContain('req-42');
    expect(toSender).toMatchObject({
      subject: `We have your message (${reference})`,
      to: [{ email: 'ana@example.test', name: 'Ana Pop' }],
    });
    expect(toSender.textContent).toContain('We answer within one working day.');
    expect(toSender.textContent).toContain('https://motorfix.test/en/contact');
    expect(toSender).not.toHaveProperty('replyTo');
    expect(await row(id)).toMatchObject({
      acknowledgementAt: expect.any(Date),
      acknowledgementStatus: 'sent',
      supportEmailAt: expect.any(Date),
      supportEmailStatus: 'sent',
    });
    expect(await emails('support', 'sent')).toBe(sentBefore + 1);
  });

  // @traces 279-FR-004
  it('keeps the writer as reply-to of the support e-mail when the domain sets one', async () => {
    const { id } = await store();
    const config = testConfig(mock.url, { EMAIL_DOMAIN: 'example.test' });

    await delivery({ email: SUPPORT }, config).handle(job(id));

    const [toSupport, toSender] = sent();
    expect(toSupport).toMatchObject({
      replyTo: { email: 'ana@example.test', name: 'Ana Pop' },
      to: [{ email: SUPPORT }],
    });
    expect(toSender).toMatchObject({
      replyTo: { email: 'support@example.test', name: 'MotorFix' },
      to: [{ email: 'ana@example.test', name: 'Ana Pop' }],
    });
  });

  // The migrations hold Saint Andrew's day and the national day.
  it('promises the first working day after the away date, past the public holidays', async () => {
    const { id } = await store({ language: 'ro' });

    await delivery({ awayUntil: '2026-11-28', email: SUPPORT }).handle(job(id));

    const toSender = sent()[1];
    expect(toSender.textContent).toContain(
      'Îți răspundem până pe 2 decembrie 2026.',
    );
  });

  it('makes the usual promise when the away date has passed, and logs it', async () => {
    const { id } = await store();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await delivery({ awayUntil: '2026-01-01', email: SUPPORT }).handle(job(id));

    expect(sent()[1].textContent).toContain(
      'We answer within one working day.',
    );
    const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('SUPPORT_AWAY_UNTIL 2026-01-01');
    warn.mockRestore();
  });

  it('leaves an e-mail Brevo refused pending, throws, and never sends the other twice', async () => {
    const { id } = await store();
    const failedBefore = await emails('acknowledgement', 'failed');
    mock.answer(
      { body: { messageId: '<1@relay>' }, status: 201 },
      { status: 503 },
    );

    await expect(delivery().handle(job(id))).rejects.toThrow();
    expect(await row(id)).toMatchObject({
      acknowledgementStatus: 'pending',
      supportEmailStatus: 'sent',
    });
    expect(await emails('acknowledgement', 'failed')).toBe(failedBefore + 1);

    await delivery().handle(job(id));

    const subjects = sent().map((mail) => mail.subject);
    expect(subjects.filter((s: string) => s.startsWith('['))).toHaveLength(1);
    expect(await row(id)).toMatchObject({ acknowledgementStatus: 'sent' });
  });

  it('still acknowledges when the support e-mail fails', async () => {
    const { id } = await store();
    mock.answer(
      { status: 500 },
      { body: { messageId: '<2@relay>' }, status: 201 },
    );

    await expect(delivery().handle(job(id))).rejects.toThrow();

    expect(await row(id)).toMatchObject({
      acknowledgementStatus: 'sent',
      supportEmailStatus: 'pending',
    });
  });

  it('with no support address, marks it unconfigured, logs SUPPORT_EMAIL, and still acknowledges', async () => {
    const { id, reference } = await store();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const before = await emails('support', 'unconfigured');

    await delivery({}).handle(job(id));

    expect(mock.emails()).toHaveLength(1);
    expect(sent()[0].to).toEqual([
      { email: 'ana@example.test', name: 'Ana Pop' },
    ]);
    expect(await row(id)).toMatchObject({
      acknowledgementStatus: 'sent',
      supportEmailStatus: 'unconfigured',
    });
    const logged = error.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('SUPPORT_EMAIL');
    expect(logged).toContain(reference);
    expect(logged).not.toContain('ana@example.test');
    expect(await emails('support', 'unconfigured')).toBe(before + 1);
    error.mockRestore();
  });

  it('sends an unconfigured support e-mail once an address is set', async () => {
    const { id } = await store();
    await delivery({}).handle(job(id));

    await delivery().handle(job(id));

    expect(sent().map((mail) => mail.to[0].email)).toEqual([
      'ana@example.test',
      SUPPORT,
    ]);
    expect(await row(id)).toMatchObject({ supportEmailStatus: 'sent' });
  });

  it('marks both blocked while sending is off, and sends nothing', async () => {
    const { id } = await store();
    const off = testConfig(mock.url, { EMAIL_SENDING: 'off' });

    await delivery({ email: SUPPORT }, off).handle(job(id));

    expect(mock.emails()).toHaveLength(0);
    expect(await row(id)).toMatchObject({
      acknowledgementStatus: 'blocked',
      supportEmailStatus: 'blocked',
    });
  });

  it('blocks only the address the allowlist refuses', async () => {
    const { id } = await store({ email: 'ana@elsewhere.test' });

    await delivery().handle(job(id));

    expect(mock.emails()).toHaveLength(1);
    expect(await row(id)).toMatchObject({
      acknowledgementStatus: 'blocked',
      supportEmailStatus: 'sent',
    });
  });

  it('does nothing for a message that is gone or an event with no id', async () => {
    await delivery().handle(job('00000000-0000-4000-8000-000000000000'));
    await delivery().handle({ data: { id: 'event', payload: {} } } as never);

    expect(mock.emails()).toHaveLength(0);
  });
});

describe('queueing unsent messages again', () => {
  const relayedAgo = (minutes: number) =>
    prisma.$executeRawUnsafe(
      `UPDATE outbox_event SET relayed_at = now() - interval '${minutes} minutes'`,
    );
  const relayed = async () =>
    (await prisma.outboxEvent.findFirstOrThrow()).relayedAt;

  it('requeues a pending message relayed over 5 minutes ago', async () => {
    await store();
    await relayedAgo(6);

    expect(
      await supportMessagesConsumer({ email: SUPPORT }).requeue(prisma),
    ).toBe(1);
    expect(await relayed()).toBeNull();
  });

  it('leaves one relayed less than 5 minutes ago', async () => {
    await store();
    await relayedAgo(2);

    expect(
      await supportMessagesConsumer({ email: SUPPORT }).requeue(prisma),
    ).toBe(0);
  });

  it('leaves a message whose e-mails are sent or blocked', async () => {
    const { id } = await store();
    await prisma.supportMessage.update({
      data: { acknowledgementStatus: 'sent', supportEmailStatus: 'blocked' },
      where: { id },
    });
    await relayedAgo(6);

    expect(
      await supportMessagesConsumer({ email: SUPPORT }).requeue(prisma),
    ).toBe(0);
  });

  it('requeues an unconfigured support e-mail only once an address is set', async () => {
    const { id } = await store();
    await prisma.supportMessage.update({
      data: {
        acknowledgementStatus: 'sent',
        supportEmailStatus: 'unconfigured',
      },
      where: { id },
    });
    await relayedAgo(6);

    expect(await supportMessagesConsumer({}).requeue(prisma)).toBe(0);
    expect(
      await supportMessagesConsumer({ email: SUPPORT }).requeue(prisma),
    ).toBe(1);
  });

  it('requeues a pending acknowledgement while no address is set', async () => {
    const { id } = await store();
    await prisma.supportMessage.update({
      data: { supportEmailStatus: 'unconfigured' },
      where: { id },
    });
    await relayedAgo(6);

    expect(await supportMessagesConsumer({}).requeue(prisma)).toBe(1);
  });
});

describe('the unsent gauge', () => {
  it('counts pending and unconfigured support e-mails, not blocked or sent ones', async () => {
    const statuses = ['pending', 'unconfigured', 'blocked', 'sent'] as const;
    for (const status of statuses) {
      const { id } = await store();
      await prisma.supportMessage.update({
        data: { supportEmailStatus: status },
        where: { id },
      });
    }

    expect(await countUnsent(prisma)).toBe(2);
  });

  it('reports the count it last read', async () => {
    await store();
    const stop = observeUnsent(() => countUnsent(prisma));
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(await counterTotal(reader, 'motorfix_support_messages_unsent')).toBe(
      1,
    );
    stop();
  });
});
