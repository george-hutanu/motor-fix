import { randomUUID } from 'node:crypto';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { VerificationResultFanOut } from './verification-result.fan-out';
import { serialDatabase } from '../../auth/serial-db.testing';
import { NotificationsModule } from '../notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../notifications.testing';

const redisUrl = redisUrlFor(7);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const reader = countedMetrics();
const counted = (outcome: string) =>
  counterTotal(reader, 'motorfix_verification_result_total', { outcome });

let app: TestingModule | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  jest.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  await reset();
  await prisma.outboxEvent.deleteMany();
});

async function start() {
  app = await Test.createTestingModule({
    imports: [
      NotificationsModule.registerWorker({
        databaseUrl,
        email: testConfig('http://127.0.0.1:9'),
        phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
        push: {
          privateKey: 'private',
          publicKey: 'public',
          subject: 'mailto:ops@example.test',
        },
        redisUrl,
      }),
    ],
  }).compile();
  await app.init();
  return app.get(VerificationResultFanOut);
}

async function garageWith(key: string, file: Record<string, unknown> = {}) {
  const garage = await prisma.garage.create({
    data: { name: `Atelier ${key}`, slug: `atelier-${key}-${randomUUID()}` },
  });
  const owner = await account(`${key}-owner`, ['garage']);
  await prisma.garageMember.create({
    data: { accountId: owner, garageId: garage.id, role: 'owner' },
  });
  const verification = await prisma.verificationFile.create({
    data: { garageId: garage.id, status: 'in_review', ...file },
  });
  return { file: verification, garage, owner };
}

const jobOf = (payload: Record<string, unknown>, id = randomUUID()) =>
  ({ data: { id, kind: 'verification.decided', payload } }) as never;

const sent = (accountId: string) =>
  prisma.notification.findMany({
    orderBy: { createdAt: 'asc' },
    where: { accountId, fallbackOf: null, kind: 'VERIFICATION_RESULT' },
  });

const total = () =>
  prisma.notification.count({ where: { kind: 'VERIFICATION_RESULT' } });

// @traces 209-FR-001
describe('a decision payload the relay should never have sent', () => {
  it.each([
    ['Approved'],
    ['APPROVED'],
    ['constructor'],
    ['__proto__'],
    ['toString'],
    ['hasOwnProperty'],
    [' approved'],
    [''],
    ['reopened'],
  ])(
    'tells nobody about the decision %p and counts a skip',
    async (decision) => {
      const { file, owner } = await garageWith('dec');
      const fanOut = await start();
      const before = await counted('skipped');

      await fanOut.handle(
        jobOf({ decision, fileId: file.id, garageId: file.garageId }),
      );

      expect(await sent(owner)).toEqual([]);
      expect(await counted('skipped')).toBe(before + 1);
    },
  );

  it('tells nobody and counts a skip when the decision is missing', async () => {
    const { file, owner } = await garageWith('nodec');
    const fanOut = await start();
    const before = await counted('skipped');

    await fanOut.handle(jobOf({ fileId: file.id, garageId: file.garageId }));

    expect(await sent(owner)).toEqual([]);
    expect(await counted('skipped')).toBe(before + 1);
  });

  it('tells nobody and counts a skip when the decision is null', async () => {
    const { file, owner } = await garageWith('nulldec');
    const fanOut = await start();
    const before = await counted('skipped');

    await fanOut.handle(
      jobOf({ decision: null, fileId: file.id, garageId: file.garageId }),
    );

    expect(await sent(owner)).toEqual([]);
    expect(await counted('skipped')).toBe(before + 1);
  });

  it('tells nobody and counts a skip for a file that does not exist', async () => {
    const { garage, owner } = await garageWith('nofile');
    const fanOut = await start();
    const before = await counted('skipped');

    await fanOut.handle(
      jobOf({
        decision: 'rejected',
        fileId: randomUUID(),
        garageId: garage.id,
      }),
    );

    expect(await sent(owner)).toEqual([]);
    expect(await counted('skipped')).toBe(before + 1);
  });

  it('tells nobody and counts a skip for a garage that does not exist', async () => {
    const { file } = await garageWith('nogarage');
    const fanOut = await start();
    const before = await counted('skipped');

    await fanOut.handle(
      jobOf({ decision: 'approved', fileId: file.id, garageId: randomUUID() }),
    );

    expect(await total()).toBe(0);
    expect(await counted('skipped')).toBe(before + 1);
  });

  it('does not crash the run for a payload with no file id', async () => {
    const { garage, owner } = await garageWith('nofileid');
    const fanOut = await start();

    await expect(
      fanOut.handle(jobOf({ decision: 'approved', garageId: garage.id })),
    ).resolves.toBeUndefined();
    expect(await sent(owner)).toEqual([]);
  });

  it('does not crash the run for an empty payload', async () => {
    const fanOut = await start();

    await expect(fanOut.handle(jobOf({}))).resolves.toBeUndefined();
    expect(await total()).toBe(0);
  });
});

// @traces 209-FR-011
describe('a payload that names another garage than the file’s', () => {
  it('does not tell the owners of the named garage about another garage’s file', async () => {
    const a = await garageWith('a', {
      reasonCode: 'rar',
      reasonNote: 'NOTA-SECRETA-A',
      status: 'rejected',
    });
    const b = await garageWith('b');
    const fanOut = await start();

    await fanOut.handle(
      jobOf({ decision: 'rejected', fileId: a.file.id, garageId: b.garage.id }),
    );

    expect(JSON.stringify(await sent(b.owner))).not.toContain('NOTA-SECRETA-A');
  });

  it('does not tell owners of the file’s own garage under the wrong garage id either', async () => {
    const a = await garageWith('c');
    const b = await garageWith('d');
    const fanOut = await start();

    await fanOut.handle(
      jobOf({ decision: 'approved', fileId: a.file.id, garageId: b.garage.id }),
    );

    expect((await sent(b.owner)).map((m) => m.subjectId)).toEqual([]);
  });
});

// @traces 209-FR-002
describe('who counts as an owner', () => {
  it('tells an owner who is also a mechanic once, and a mechanic who is not an owner never', async () => {
    const { file, garage, owner } = await garageWith('dual');
    await prisma.mechanic.create({
      data: {
        accountId: owner,
        canAnswerQuotes: true,
        garageId: garage.id,
        name: 'Mihai',
      },
    });
    const plain = await account('dual-mechanic', ['mechanic']);
    await prisma.mechanic.create({
      data: {
        accountId: plain,
        canAnswerQuotes: true,
        garageId: garage.id,
        name: 'Ion',
      },
    });
    const fanOut = await start();

    await fanOut.handle(
      jobOf({ decision: 'approved', fileId: file.id, garageId: garage.id }),
    );

    expect((await sent(owner)).map((m) => m.channel).sort()).toEqual([
      'email',
      'in_app',
    ]);
    expect(await sent(plain)).toEqual([]);
  });

  it('tells the surviving owner once when a second owner of the same language is deleted', async () => {
    const { file, garage, owner } = await garageWith('twin');
    const gone = await account('twin-gone', ['garage']);
    await prisma.garageMember.create({
      data: { accountId: gone, garageId: garage.id, role: 'owner' },
    });
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: gone },
    });
    const fanOut = await start();

    await fanOut.handle(
      jobOf({ decision: 'approved', fileId: file.id, garageId: garage.id }),
    );

    expect((await sent(owner)).map((m) => m.channel).sort()).toEqual([
      'email',
      'in_app',
    ]);
    expect(await sent(gone)).toEqual([]);
  });

  it('tells two owners of the same language each once', async () => {
    const { file, garage, owner } = await garageWith('pair');
    const second = await account('pair-second', ['garage']);
    await prisma.garageMember.create({
      data: { accountId: second, garageId: garage.id, role: 'owner' },
    });
    const fanOut = await start();

    await fanOut.handle(
      jobOf({ decision: 'approved', fileId: file.id, garageId: garage.id }),
    );

    expect((await sent(owner)).length).toBe(2);
    expect((await sent(second)).length).toBe(2);
  });
});

// @traces 209-FR-010
describe('a stored note that is odd', () => {
  it('passes a whitespace-only note on as written', async () => {
    const { file, owner } = await garageWith('ws', {
      reasonCode: 'documents',
      reasonNote: '   \n  ',
      status: 'rejected',
    });
    const fanOut = await start();

    await fanOut.handle(
      jobOf({ decision: 'rejected', fileId: file.id, garageId: file.garageId }),
    );

    const email = (await sent(owner)).find((m) => m.channel === 'email');
    expect(email?.params).toMatchObject({ note: '   \n  ' });
  });

  it('keeps placeholders written in the note verbatim in the stored params', async () => {
    const note = '{link} {reason} {note} {{decision}}';
    const { file, owner } = await garageWith('ph', {
      reasonCode: 'photos',
      reasonNote: note,
      status: 'more_requested',
    });
    const fanOut = await start();

    await fanOut.handle(
      jobOf({
        decision: 'more_requested',
        fileId: file.id,
        garageId: file.garageId,
      }),
    );

    const email = (await sent(owner)).find((m) => m.channel === 'email');
    expect(email?.params).toMatchObject({ note, reason: 'Fotografii' });
  });

  it('carries a 100 000 character note whole', async () => {
    const note = 'ă'.repeat(100_000);
    const { file, owner } = await garageWith('long', {
      reasonCode: 'other',
      reasonNote: note,
      status: 'rejected',
    });
    const fanOut = await start();

    await fanOut.handle(
      jobOf({ decision: 'rejected', fileId: file.id, garageId: file.garageId }),
    );

    const email = (await sent(owner)).find((m) => m.channel === 'email');
    expect(email?.params).toMatchObject({ note });
  });

  it('does not fail the run for a rejected file that has no stored reason', async () => {
    const { file, owner } = await garageWith('bare');
    const fanOut = await start();

    await expect(
      fanOut.handle(
        jobOf({
          decision: 'rejected',
          fileId: file.id,
          garageId: file.garageId,
        }),
      ),
    ).resolves.toBeUndefined();
    expect((await sent(owner)).map((m) => m.channel).sort()).toEqual([
      'email',
      'in_app',
    ]);
  });

  it('labels a stored prototype-key reason code as the other reason', async () => {
    const { file, owner } = await garageWith('proto', {
      reasonCode: 'constructor',
      reasonNote: 'x',
      status: 'rejected',
    });
    const fanOut = await start();

    await fanOut.handle(
      jobOf({ decision: 'rejected', fileId: file.id, garageId: file.garageId }),
    );

    const email = (await sent(owner)).find((m) => m.channel === 'email');
    expect(email?.params).toMatchObject({ reason: 'Alt motiv' });
  });
});

// @traces 209-FR-012
describe('the same event twice', () => {
  it('builds once for one event id even when the second payload differs', async () => {
    const { file, owner } = await garageWith('twice');
    const fanOut = await start();
    const id = randomUUID();

    await fanOut.handle(
      jobOf(
        { decision: 'approved', fileId: file.id, garageId: file.garageId },
        id,
      ),
    );
    await fanOut.handle(
      jobOf(
        { decision: 'rejected', fileId: file.id, garageId: file.garageId },
        id,
      ),
    );

    expect((await sent(owner)).length).toBe(2);
  });

  it('builds twice for two events on one file', async () => {
    const { file, owner } = await garageWith('events');
    const fanOut = await start();
    const payload = {
      decision: 'approved',
      fileId: file.id,
      garageId: file.garageId,
    };

    await fanOut.handle(jobOf(payload));
    await fanOut.handle(jobOf(payload));

    expect((await sent(owner)).length).toBe(4);
  });
});
