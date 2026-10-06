import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { Brevo } from './brevo';
import { BrevoMock } from './brevo-mock.testing';
import { newsLinks, unsubscribeToken } from './news';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsService } from './notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from './notifications.testing';
import { AuditService } from '../audit/audit.service';
import { serialDatabase } from '../auth/serial-db.testing';

const redisUrl = redisUrlFor(5);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const mock = new BrevoMock();
const queue = new Queue('notifications', { connection: { url: redisUrl } });
const publisher = new Redis(redisUrl);

let service: NotificationsService;
let processor: NotificationsProcessor;

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
  const config = testConfig(mock.url);
  service = new NotificationsService(
    prisma,
    queue,
    publisher,
    config,
    null,
    new AuditService(),
  );
  service.now = () => new Date('2026-11-05T10:00:00Z');
  processor = new NotificationsProcessor(
    prisma,
    service,
    new Brevo({ apiKey: config.apiKey ?? '', apiUrl: config.apiUrl }),
    config,
    testPhoneConfig({ PHONE_SENDING: 'off', WHATSAPP_SENDER: '' }),
  );
});

const emailRow = (accountId: string, kind: string) =>
  prisma.notification.findFirstOrThrow({
    where: { accountId, channel: 'email', kind },
  });

const sendJob = (id: string) =>
  processor.handle({ attemptsMade: 0, data: { id }, name: 'send' });

interface Sent {
  headers?: Record<string, string>;
  htmlContent: string;
  textContent: string;
}

describe('a news e-mail', () => {
  it('carries the one-click headers and the visible stop link', async () => {
    const driver = await account('andrei', ['driver'], { language: 'ro' });
    await prisma.notificationPreference.create({
      data: {
        accountId: driver,
        channel: 'email',
        consentGivenAt: new Date('2026-10-10T10:00:00Z'),
        consentTextVersion: '2026-10-03',
        enabled: true,
        type: 'NEWS',
      },
    });
    const links = newsLinks(
      'https://motorfix.test',
      'ro',
      unsubscribeToken(driver, 'test-secret'),
    );
    await service.notify({
      eventId: 'news-1',
      kind: 'NEWS',
      params: {
        text: 'Primele service-uri din Cluj.',
        title: 'Noutăți',
        ...links,
      },
      recipients: [driver],
    });
    await sendJob((await emailRow(driver, 'NEWS')).id);
    const [sent] = mock.emails().map((c) => c.body as Sent);
    expect(sent.headers).toEqual({
      'List-Unsubscribe': `<${links.oneClick}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect(sent.htmlContent).toContain(`href="${links.unsubscribe}"`);
    expect(sent.htmlContent).toContain('Nu mai vreau noutăți');
    expect(sent.textContent).toContain(links.unsubscribe);
  });
});

describe('any other e-mail', () => {
  it('carries no unsubscribe headers', async () => {
    const driver = await account('andrei', ['driver'], { language: 'en' });
    await service.notify({
      eventId: 'test-1',
      kind: 'TEST_MESSAGE',
      recipients: [driver],
    });
    await sendJob((await emailRow(driver, 'TEST_MESSAGE')).id);
    const [sent] = mock.emails().map((c) => c.body as Sent);
    expect(sent.headers).toBeUndefined();
  });
});
