import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { Brevo } from './brevo/brevo';
import { BrevoMock } from './brevo/brevo-mock.testing';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsService, RETRY_MINUTES } from './notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from './notifications.testing';
import { AuditService } from '../audit/audit.service';
import { serialDatabase } from '../auth/serial-db.testing';

const redisUrl = redisUrlFor(13);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const mock = new BrevoMock();
const queue = new Queue('notifications', { connection: { url: redisUrl } });
const publisher = new Redis(redisUrl);

let service: NotificationsService;
let processor: NotificationsProcessor;

function build(overrides: Record<string, string> = {}) {
  const config = testConfig(mock.url, overrides);
  service = new NotificationsService(
    prisma,
    queue,
    publisher,
    config,
    null,
    new AuditService(),
  );
  service.now = () => new Date('2026-10-05T11:00:00Z');
  processor = new NotificationsProcessor(
    prisma,
    service,
    new Brevo({ apiKey: config.apiKey ?? '', apiUrl: config.apiUrl }),
    config,
    testPhoneConfig({ PHONE_SENDING: 'off', WHATSAPP_SENDER: '' }),
  );
}

beforeAll(() => mock.start());

afterAll(async () => {
  await queue.close();
  publisher.disconnect();
  await mock.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await queue.obliterate({ force: true });
  mock.reset();
  build();
});

const rowsOf = (accountId: string) =>
  prisma.notification.findMany({
    orderBy: [{ createdAt: 'asc' }, { channel: 'asc' }],
    where: { accountId },
  });

const emailRow = (accountId: string) =>
  prisma.notification.findFirstOrThrow({
    where: { accountId, channel: 'email' },
  });

const sendJob = (id: string, attemptsMade = 0) =>
  processor.handle({ attemptsMade, data: { id }, name: 'send' });

const hasLink = (row: { params: unknown }) => 'link' in Object(row.params);

const sentText = () =>
  (mock.emails().at(-1)!.body as { textContent: string }).textContent;

describe('every purpose of an account e-mail', () => {
  it.each(['email_check', 'password_reset', 'password_changed'] as const)(
    'carries the %s link in the message and leaves none on any row',
    async (purpose) => {
      const ana = await account('ana');
      const link = `https://motorfix.test/ro/${purpose}/tok-${purpose}`;
      await service.sendAccountEmail({ accountId: ana, link, purpose });
      await sendJob((await emailRow(ana)).id);
      expect(sentText()).toContain(link);
      const rows = await rowsOf(ana);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.params)).toEqual([{ purpose }, { purpose }]);
    },
  );
});

describe('a link with awkward characters', () => {
  it('reaches the message intact and is gone from the row afterwards', async () => {
    const ana = await account('ana');
    const link = 'https://motorfix.test/reset?t=a%20b&x="q"&u=ăîșț€#frag';
    await service.sendAccountEmail({
      accountId: ana,
      link,
      purpose: 'password_reset',
    });
    await sendJob((await emailRow(ana)).id);
    expect(sentText()).toContain(link);
    expect((await emailRow(ana)).params).toEqual({
      purpose: 'password_reset',
    });
  });

  it('survives a link of a hundred thousand characters and is still removed', async () => {
    const ana = await account('ana');
    const link = `https://motorfix.test/reset?t=${'a'.repeat(100_000)}`;
    await service.sendAccountEmail({
      accountId: ana,
      link,
      purpose: 'password_reset',
    });
    await sendJob((await emailRow(ana)).id);
    expect(sentText()).toContain(link);
    expect(hasLink(await emailRow(ana))).toBe(false);
  });
});

describe('several recipients of one account e-mail event', () => {
  it('keeps the link off every bell row and off every sent row', async () => {
    const a = await account('a');
    const b = await account('b');
    await service.notify({
      eventId: 'multi',
      kind: 'ACCOUNT_EMAIL',
      params: { link: 'https://motorfix.test/x', purpose: 'email_check' },
      recipients: [a, b, a],
    });
    for (const id of [a, b]) await sendJob((await emailRow(id)).id);
    const all = [...(await rowsOf(a)), ...(await rowsOf(b))];
    expect(all).toHaveLength(4);
    expect(all.map(hasLink)).toEqual([false, false, false, false]);
  });
});

describe('the rule is by param name, not by kind', () => {
  it('keeps a link off the bell row of a kind that is not an account e-mail', async () => {
    const andrei = await account('andrei');
    await service.notify({
      eventId: 'q',
      kind: 'QUOTE_RECEIVED',
      params: { link: 'https://motorfix.test/q', other: 'kept' },
      recipients: [andrei],
    });
    const bell = await prisma.notification.findFirstOrThrow({
      where: { accountId: andrei, channel: 'in_app' },
    });
    expect(bell.params).toEqual({ other: 'kept' });
  });

  it('keeps the other params of an e-mail row when it is sent', async () => {
    const ana = await account('ana');
    await service.notify({
      eventId: 'extra',
      kind: 'ACCOUNT_EMAIL',
      params: {
        extra: { nested: [1, 2] },
        link: 'https://motorfix.test/x',
        purpose: 'password_reset',
      },
      recipients: [ana],
    });
    await sendJob((await emailRow(ana)).id);
    expect((await emailRow(ana)).params).toEqual({
      extra: { nested: [1, 2] },
      purpose: 'password_reset',
    });
  });

  it('leaves a param named differently in case alone', async () => {
    const ana = await account('ana');
    await service.notify({
      eventId: 'case',
      kind: 'ACCOUNT_EMAIL',
      params: {
        Link: 'keep-me',
        link: 'https://motorfix.test/x',
        purpose: 'password_reset',
      },
      recipients: [ana],
    });
    await sendJob((await emailRow(ana)).id);
    expect((await emailRow(ana)).params).toEqual({
      Link: 'keep-me',
      purpose: 'password_reset',
    });
  });
});

describe('a link that is not usable', () => {
  it.each([
    ['empty', ''],
    ['null', null],
    ['a number', 42],
  ])('stores no link once the job has run when it is %s', async (_n, link) => {
    const ana = await account('ana');
    await service.notify({
      eventId: 'bad',
      kind: 'ACCOUNT_EMAIL',
      params: { link, purpose: 'password_reset' } as never,
      recipients: [ana],
    });
    await sendJob((await emailRow(ana)).id);
    const row = await emailRow(ana);
    expect(['sent', 'failed']).toContain(row.status);
    expect(hasLink(row)).toBe(false);
  });
});

describe('retries', () => {
  it('keeps the link through a refusal for retry and drops it when the retry sends', async () => {
    const ana = await account('ana');
    await service.sendAccountEmail({
      accountId: ana,
      link: 'https://motorfix.test/retry',
      purpose: 'password_reset',
    });
    const { id } = await emailRow(ana);
    mock.answer({ status: 503 });
    await expect(sendJob(id, 0)).rejects.toBeDefined();
    expect(await emailRow(ana)).toMatchObject({ status: 'queued' });
    expect(hasLink(await emailRow(ana))).toBe(true);
    await sendJob(id, 1);
    expect(sentText()).toContain('https://motorfix.test/retry');
    expect(await emailRow(ana)).toMatchObject({ status: 'sent' });
    expect(hasLink(await emailRow(ana))).toBe(false);
  });

  it('drops the link when Brevo is still refusing on the last attempt', async () => {
    const ana = await account('ana');
    await service.sendAccountEmail({
      accountId: ana,
      link: 'https://motorfix.test/last',
      purpose: 'password_reset',
    });
    mock.answer({ status: 503 });
    await sendJob((await emailRow(ana)).id, RETRY_MINUTES.length);
    const row = await emailRow(ana);
    expect([row.status, hasLink(row)]).toEqual(['failed', false]);
  });

  it('keeps the link while the last retryable attempt before the limit is still pending', async () => {
    const ana = await account('ana');
    await service.sendAccountEmail({
      accountId: ana,
      link: 'https://motorfix.test/edge',
      purpose: 'password_reset',
    });
    mock.answer({ status: 429 });
    await expect(
      sendJob((await emailRow(ana)).id, RETRY_MINUTES.length - 1),
    ).rejects.toBeDefined();
    expect(hasLink(await emailRow(ana))).toBe(true);
  });

  it('does not bring the link back when a sent job runs again', async () => {
    const ana = await account('ana');
    await service.sendAccountEmail({
      accountId: ana,
      link: 'https://motorfix.test/twice',
      purpose: 'password_reset',
    });
    const { id } = await emailRow(ana);
    await sendJob(id);
    await sendJob(id);
    expect(mock.emails()).toHaveLength(1);
    expect(hasLink(await emailRow(ana))).toBe(false);
  });

  it('does not bring the link back when a failed job runs again', async () => {
    const ana = await account('ana');
    await service.sendAccountEmail({
      accountId: ana,
      link: 'https://motorfix.test/again',
      purpose: 'password_reset',
    });
    const { id } = await emailRow(ana);
    mock.answer({ status: 400 });
    await sendJob(id);
    await sendJob(id);
    expect(mock.emails()).toHaveLength(1);
    expect(hasLink(await emailRow(ana))).toBe(false);
  });
});

describe('failing rows directly', () => {
  async function queued(name: string) {
    const id = await account(name);
    await service.sendAccountEmail({
      accountId: id,
      link: `https://motorfix.test/${name}`,
      purpose: 'password_reset',
    });
    return { id, row: await emailRow(id) };
  }

  it.each([false, true, 'email'] as const)(
    'drops the link and keeps the purpose with fallback %s',
    async (mode) => {
      const { id, row } = await queued('direct');
      await service.fail([row], 'boom', mode);
      const rows = (await rowsOf(id)).filter((r) => r.channel === 'email');
      expect(rows.every((r) => !hasLink(r))).toBe(true);
      expect(rows[0]).toMatchObject({
        failure: 'boom',
        params: { purpose: 'password_reset' },
        status: 'failed',
      });
    },
  );

  it('drops the link of every row in a batch', async () => {
    const one = await queued('one');
    const two = await queued('two');
    await service.fail([one.row, two.row], 'boom', false);
    expect(hasLink(await emailRow(one.id))).toBe(false);
    expect(hasLink(await emailRow(two.id))).toBe(false);
  });

  it('leaves the link of a row that is not in the batch', async () => {
    const one = await queued('one');
    const two = await queued('two');
    await service.fail([one.row], 'boom', false);
    expect(hasLink(await emailRow(two.id))).toBe(true);
  });

  it('accepts an empty batch', async () => {
    await expect(service.fail([], 'boom', false)).resolves.toBeUndefined();
  });

  it('forgets nothing and fails nothing for an unknown row id', async () => {
    const { id, row } = await queued('known');
    await service.forget(['00000000-0000-4000-8000-000000000000']);
    expect(await emailRow(id)).toMatchObject({ id: row.id });
    expect(hasLink(await emailRow(id))).toBe(true);
  });

  it('is the same when run twice', async () => {
    const { id, row } = await queued('idem');
    await service.fail([row], 'boom', false);
    const first = await emailRow(id);
    await service.fail([row], 'boom', false);
    expect((await emailRow(id)).params).toEqual(first.params);
  });
});

describe('rows written failed at issue time', () => {
  it('holds no link for sending off, with the purpose kept', async () => {
    build({ EMAIL_SENDING: 'off' });
    const ana = await account('ana');
    await service.sendAccountEmail({
      accountId: ana,
      link: 'https://motorfix.test/off',
      purpose: 'email_check',
    });
    expect(await emailRow(ana)).toMatchObject({
      failure: 'sending_off',
      params: { purpose: 'email_check' },
      status: 'failed',
    });
    expect(mock.emails()).toHaveLength(0);
  });

  it('holds no link for an address outside the allow-list, bell row included', async () => {
    build({ EMAIL_ALLOWLIST: 'someone@else.test' });
    const ana = await account('ana');
    await service.sendAccountEmail({
      accountId: ana,
      link: 'https://motorfix.test/deny',
      purpose: 'password_changed',
    });
    expect((await rowsOf(ana)).map(hasLink)).toEqual([false, false]);
  });

  it('holds no link for an account without an address', async () => {
    const ana = await account('ana', ['driver'], { email: null });
    await service.sendAccountEmail({
      accountId: ana,
      link: 'https://motorfix.test/none',
      purpose: 'password_reset',
    });
    expect((await rowsOf(ana)).some(hasLink)).toBe(false);
  });

  it('holds no link for a deleted account', async () => {
    const ana = await account('ana');
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: ana },
    });
    await service.sendAccountEmail({
      accountId: ana,
      link: 'https://motorfix.test/gone',
      purpose: 'password_reset',
    });
    expect((await rowsOf(ana)).some(hasLink)).toBe(false);
  });

  it('holds no link once sent to an address the allow-list matches by domain in another case', async () => {
    build({ EMAIL_ALLOWLIST: '@EXAMPLE.TEST,nobody@else.test' });
    const ana = await account('ana');
    await service.sendAccountEmail({
      accountId: ana,
      link: 'https://motorfix.test/case',
      purpose: 'password_reset',
    });
    await sendJob((await emailRow(ana)).id);
    const row = await emailRow(ana);
    expect(row.status).toBe('sent');
    expect(hasLink(row)).toBe(false);
  });
});

describe('the bell row with the link', () => {
  it('has no link even while the e-mail is still queued', async () => {
    const ana = await account('ana');
    await service.sendAccountEmail({
      accountId: ana,
      link: 'https://motorfix.test/bell',
      purpose: 'password_reset',
    });
    const bell = await prisma.notification.findFirstOrThrow({
      where: { accountId: ana, channel: 'in_app' },
    });
    expect(bell.params).toEqual({ purpose: 'password_reset' });
    const rowsWithLink = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM notification
      WHERE channel = 'in_app' AND params ? 'link'`;
    expect(Number(rowsWithLink[0].n)).toBe(0);
  });
});
