import { randomUUID } from 'node:crypto';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { HttpException, Logger } from '@nestjs/common';

import { REFUSAL_CODES, VerificationService } from './verification.service';
import { verificationConfig } from './verification-config';
import { AuditService } from '../../audit/audit.service';
import type { Actor } from '../../auth/policy';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outbox } from '../../events/event.port';
import type { Prisma } from '../../generated/prisma/client';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

// @traces 259-FR-001 259-FR-002 259-FR-003 259-FR-004 259-FR-005 259-FR-008

const reader = countedMetrics();
const refusals = (reason: string) =>
  counterTotal(reader, 'motorfix_verification_decision_refusals_total', {
    reason,
  });
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
const CHECK_KINDS = [
  'company',
  'caen',
  'rar',
  'activities',
  'representative',
  'address',
  'photos',
  'documents',
] as const;
const DOCUMENT_KINDS = ['onrc_certificate', 'rar_authorisation'] as const;
const REASON = { code: 'documents_unreadable', note: 'The CUI is blurred' };

type AppEnv = 'production' | 'development' | 'test';
type Rules = { manual?: boolean; rar?: boolean };

// The service as the app wires it for one environment and its variables.
const build = (appEnv: AppEnv, env: Record<string, string> = {}) =>
  new VerificationService(
    new AuditService(),
    outbox,
    verificationConfig(appEnv, env),
  );

// The two test-only rules as the Setări switches store them.
async function rules({ manual = false, rar = false }: Rules) {
  for (const [key, value] of [
    ['skip_manual_approval', manual],
    ['skip_rar_check', rar],
  ] as const) {
    await prisma.platformRule.upsert({
      create: { defaultValue: false, key, value },
      update: { value },
      where: { key },
    });
  }
}

const inTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  prisma.$transaction(fn);

const person = (
  accountId: string,
  role: Actor['role'],
  garageId: string | null = null,
): Actor => ({ accountId, garageId, permissions: NONE, role, roles: [role] });

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return {
        body: error.getResponse() as {
          code?: string;
          missing?: unknown[];
        },
        status: error.getStatus(),
      };
    }
    throw error;
  }
  throw new Error('the call was not refused');
}

const history = (subjectId: string) =>
  prisma.activityLog.findMany({ orderBy: { at: 'asc' }, where: { subjectId } });
const eventKinds = async (subjectId: string) =>
  (
    await prisma.outboxEvent.findMany({
      orderBy: { createdAt: 'asc' },
      where: { subjectId },
    })
  ).map((event) => event.kind);
const fileRow = (id: string) =>
  prisma.verificationFile.findUniqueOrThrow({ where: { id } });
const garageRow = () =>
  prisma.garage.findUniqueOrThrow({ where: { id: garageId } });
const setCheck = (fileId: string, kind: string, result: string) =>
  prisma.verificationCheck.upsert({
    create: { fileId, kind: kind as never, result: result as never },
    update: { result: result as never },
    where: { fileId_kind: { fileId, kind: kind as never } },
  });

// The lines the service logged that name the file.
function logged(fileId: string) {
  const log = jest.spyOn(Logger.prototype, 'log');
  return {
    lines: () =>
      log.mock.calls
        .map(([line]) => String(line))
        .filter((line) => line.includes(fileId)),
    restore: () => log.mockRestore(),
  };
}

let ioana: Actor;
let mihai: Actor;
let garageId: string;

beforeEach(async () => {
  await reset();
  await rules({});
  const garage = await prisma.garage.create({
    data: { name: 'Atelier Dinamo', slug: `dinamo-${randomUUID()}` },
  });
  garageId = garage.id;
  ioana = person(await account('Ioana Popa', ['admin']), 'admin');
  mihai = person(await account('Mihai', ['garage']), 'garage', garageId);
  await prisma.garageMember.create({
    data: { accountId: mihai.accountId, garageId, role: 'owner' },
  });
});

afterEach(() => rules({}));

afterAll(() => prisma.$disconnect());

// A file asked for more by Ioana, which the garage sends again; `rarOk`
// records the RAR check ok before it is sent.
function sentBack(rarOk = false) {
  return prisma.verificationFile.create({
    data: {
      ...(rarOk && { checks: { create: [{ kind: 'rar', result: 'ok' }] } }),
      decidedAt: new Date(),
      decidedBy: ioana.accountId,
      garageId,
      openedAt: new Date(),
      openedBy: ioana.accountId,
      reasonCode: REASON.code,
      reasonNote: REASON.note,
      status: 'more_requested',
    },
  });
}

// A file under review with every check ok and both documents held.
function inReview() {
  return prisma.verificationFile.create({
    data: {
      checks: { create: CHECK_KINDS.map((kind) => ({ kind, result: 'ok' })) },
      documents: {
        create: DOCUMENT_KINDS.map((kind) => ({ kind, pages: ['p1'] })),
      },
      garageId,
      openedAt: new Date(),
      openedBy: ioana.accountId,
      status: 'in_review',
    },
  });
}

const approve = (service: VerificationService, fileId: string, note?: string) =>
  inTx((tx) =>
    service.decide(tx, ioana, fileId, {
      outcome: 'approved',
      ...(note && { note }),
    }),
  );

describe('production', () => {
  const production = () =>
    build('production', { SKIP_MANUAL_APPROVAL: 'true' });

  it('leaves a sending waiting whatever the rules and the variable say', async () => {
    await rules({ manual: true, rar: true });

    const file = await inTx((tx) => production().submit(tx, mihai, garageId));

    expect((await fileRow(file.id)).status).toBe('submitted');
    expect(await eventKinds(file.id)).toEqual(['verification.submitted']);
    expect((await garageRow()).status).toBe('draft');
  });

  it('leaves a file sent again waiting, even with the RAR check ok', async () => {
    await rules({ manual: true, rar: true });
    const sent = await sentBack(true);

    await inTx((tx) => production().resend(tx, mihai, sent.id));

    expect((await fileRow(sent.id)).status).toBe('submitted');
    expect(await eventKinds(sent.id)).toEqual(['verification.submitted']);
  });

  it('holds the rar gate with the RAR switch stored on', async () => {
    await rules({ manual: true, rar: true });
    const file = await inReview();
    await setCheck(file.id, 'rar', 'not_run');

    const refused = await refusal(approve(production(), file.id, 'ok'));

    expect(refused).toMatchObject({
      body: { code: 'rar_check_required' },
      status: 409,
    });
  });

  it('holds the caen gate with the RAR switch stored on', async () => {
    await rules({ manual: true, rar: true });
    const file = await inReview();
    await setCheck(file.id, 'caen', 'failed');

    const refused = await refusal(approve(production(), file.id, 'ok'));

    expect(refused).toMatchObject({
      body: { code: 'caen_check_required' },
      status: 409,
    });
  });
});

describe('the variable outside the test environment', () => {
  it('is ignored in development, where only the stored rule counts', async () => {
    await rules({ manual: false, rar: true });

    const file = await inTx((tx) =>
      build('development', { SKIP_MANUAL_APPROVAL: 'true' }).submit(
        tx,
        mihai,
        garageId,
      ),
    );

    expect((await fileRow(file.id)).status).toBe('submitted');
  });
});

describe('the automatic approval', () => {
  it('approves a sending at once as MotorFix when both rules are on', async () => {
    await rules({ manual: true, rar: true });

    const file = await inTx((tx) =>
      build('development').submit(tx, mihai, garageId),
    );

    expect(file).toMatchObject({ decidedBy: null, status: 'approved' });
    const entries = await history(file.id);
    expect(entries.map((e) => [e.action, e.actorName, e.actorRole])).toEqual([
      ['create', 'Mihai', 'owner'],
      ['update', 'MotorFix', 'system'],
    ]);
    expect(await eventKinds(file.id)).toEqual([
      'verification.submitted',
      'verification.decided',
    ]);
    const garage = await garageRow();
    expect(garage.status).toBe('approved');
    expect(garage.approvedAt).not.toBeNull();
    expect(garage.lastCheckedOn).not.toBeNull();
  });

  it('leaves a sending waiting, refusing nothing, when the RAR rule is unmet', async () => {
    await rules({ manual: true, rar: false });
    const before = await refusals('rar_check_required');
    const log = jest.spyOn(Logger.prototype, 'log');

    const file = await inTx((tx) =>
      build('development').submit(tx, mihai, garageId),
    );

    expect((await fileRow(file.id)).status).toBe('submitted');
    expect(await eventKinds(file.id)).toEqual(['verification.submitted']);
    expect(await refusals('rar_check_required')).toBe(before);
    expect(
      log.mock.calls.filter(
        ([line]) =>
          String(line) ===
          `file ${file.id} automatic approval waited: rar_check_required`,
      ),
    ).toHaveLength(1);
    log.mockRestore();
  });

  it('approves a file sent again once its RAR check is ok', async () => {
    await rules({ manual: true, rar: false });
    const sent = await sentBack(true);

    await inTx((tx) => build('development').resend(tx, mihai, sent.id));

    expect(await fileRow(sent.id)).toMatchObject({
      decidedBy: null,
      status: 'approved',
    });
    expect((await history(sent.id)).map((e) => e.actorName)).toEqual([
      'Mihai',
      'MotorFix',
    ]);
    expect(await eventKinds(sent.id)).toEqual([
      'verification.submitted',
      'verification.decided',
    ]);
    expect((await garageRow()).status).toBe('approved');
  });

  it('approves a file sent again with the RAR switch on', async () => {
    await rules({ manual: true, rar: true });
    const sent = await sentBack();

    await inTx((tx) => build('development').resend(tx, mihai, sent.id));

    expect((await fileRow(sent.id)).status).toBe('approved');
  });

  it('leaves a file sent again waiting while its RAR check is not ok', async () => {
    await rules({ manual: true, rar: false });
    const sent = await sentBack();
    const log = logged(sent.id);

    await inTx((tx) => build('development').resend(tx, mihai, sent.id));

    expect((await fileRow(sent.id)).status).toBe('submitted');
    expect(log.lines()).toContain(
      `file ${sent.id} automatic approval waited: rar_check_required`,
    );
    log.restore();
  });

  it('leaves a suspended garage waiting, naming why', async () => {
    await rules({ manual: true, rar: true });
    const sent = await sentBack(true);
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: garageId },
    });
    const before = await refusals('already_decided');
    const log = logged(sent.id);

    await inTx((tx) => build('development').resend(tx, mihai, sent.id));

    expect((await fileRow(sent.id)).status).toBe('submitted');
    expect((await garageRow()).status).toBe('suspended');
    expect(log.lines()).toEqual(
      expect.arrayContaining([
        `file ${sent.id} automatic approval waited: garage_suspended`,
      ]),
    );
    expect(await refusals('already_decided')).toBe(before);
    log.restore();
  });

  it('changes nothing while manual approval stays on', async () => {
    await rules({ manual: false, rar: true });
    const log = jest.spyOn(Logger.prototype, 'log');

    const file = await inTx((tx) =>
      build('development').submit(tx, mihai, garageId),
    );

    expect((await fileRow(file.id)).status).toBe('submitted');
    expect(
      log.mock.calls.filter(([line]) =>
        String(line).includes('automatic approval waited'),
      ),
    ).toHaveLength(0);
    log.mockRestore();
  });

  it('takes the variable under APP_ENV=test as the switch, with the same RAR rule', async () => {
    const test = () => build('test', { SKIP_MANUAL_APPROVAL: '1' });
    await rules({ manual: false, rar: false });
    const waiting = await inTx((tx) => test().submit(tx, mihai, garageId));
    expect((await fileRow(waiting.id)).status).toBe('submitted');

    const other = await prisma.garage.create({
      data: { name: 'Service Nord', slug: `nord-${randomUUID()}` },
    });
    await rules({ manual: false, rar: true });
    const approved = await inTx((tx) =>
      test().submit(tx, person(mihai.accountId, 'garage', other.id), other.id),
    );

    expect((await fileRow(approved.id)).status).toBe('approved');
  });
});

describe('the RAR switch on an admin approval', () => {
  const development = () => build('development');

  it.each(['not_run', 'failed', 'warning'])(
    'lifts both register gates with rar and caen %s, asking no note',
    async (result) => {
      await rules({ rar: true });
      const file = await inReview();
      await setCheck(file.id, 'rar', result);
      await setCheck(file.id, 'caen', result);

      await approve(development(), file.id);

      expect((await fileRow(file.id)).status).toBe('approved');
      const missing = (await history(garageId)).find(
        (entry) => entry.field === 'verificationMissing',
      );
      expect(missing?.newValue).toEqual([]);
    },
  );

  it('still asks a note of a guide check not ok, naming no register', async () => {
    await rules({ rar: true });
    const file = await inReview();
    await setCheck(file.id, 'rar', 'not_run');
    await setCheck(file.id, 'caen', 'not_run');
    await setCheck(file.id, 'photos', 'failed');

    const refused = await refusal(approve(development(), file.id));

    expect(refused).toMatchObject({
      body: {
        code: 'note_required',
        missing: [{ kind: 'photos', result: 'failed' }],
      },
      status: 422,
    });
  });

  it('still asks a note of a missing certificate', async () => {
    await rules({ rar: true });
    const file = await inReview();
    await setCheck(file.id, 'caen', 'not_run');
    await prisma.legalDocument.deleteMany({
      where: { kind: 'onrc_certificate', verificationFileId: file.id },
    });

    const refused = await refusal(approve(development(), file.id));

    expect(refused).toMatchObject({
      body: {
        code: 'note_required',
        missing: [{ document: 'onrc_certificate' }],
      },
      status: 422,
    });
  });

  it('holds the caen gate when the switch is off', async () => {
    await rules({ rar: false });
    const file = await inReview();
    await setCheck(file.id, 'caen', 'not_run');

    const refused = await refusal(approve(development(), file.id, 'ok'));

    expect(refused.body.code).toBe('caen_check_required');
  });
});

describe('a refused approval in the history', () => {
  it('knows the three policy refusals and no other', () => {
    expect([...REFUSAL_CODES].sort()).toEqual([
      'caen_check_required',
      'note_required',
      'rar_check_required',
    ]);
  });

  it.each([...REFUSAL_CODES])(
    'records %s as one entry naming the admin, the file and the garage',
    async (code) => {
      const file = await inReview();
      const before = await fileRow(file.id);

      await inTx((tx) =>
        build('development').recordRefusal(tx, ioana, file.id, code),
      );

      const entries = await history(file.id);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        action: 'update',
        actorId: ioana.accountId,
        actorName: 'Ioana',
        actorRole: 'admin',
        field: 'decision',
        garageId,
        kind: 'verification_approval_refused',
        newValue: code,
        subjectType: 'verification_file',
      });
      expect(await fileRow(file.id)).toEqual(before);
      expect((await garageRow()).status).toBe('draft');
      expect(await eventKinds(file.id)).toEqual([]);
    },
  );

  it('records a second attempt as a second entry', async () => {
    const file = await inReview();
    const record = () =>
      inTx((tx) =>
        build('development').recordRefusal(
          tx,
          ioana,
          file.id,
          'rar_check_required',
        ),
      );

    await record();
    await record();

    expect(await history(file.id)).toHaveLength(2);
  });
});
