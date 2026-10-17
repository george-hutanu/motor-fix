import { randomUUID } from 'node:crypto';

import { startTelemetry } from '@motor-fix/observability';
import { counterTotal, inMemory } from '@motor-fix/observability/testing';
import { HttpException, Logger } from '@nestjs/common';

import { VerificationChecksController } from './verification-checks.controller';
import { VerificationChecksService } from './verification-checks.service';
import { AuditService } from '../../../audit/audit.service';
import type { Actor } from '../../../auth/policy';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { type EventPort, outbox } from '../../../events/event.port';
import type { Prisma } from '../../../generated/prisma/client';
import {
  databaseUrl,
  fixtures,
} from '../../../notifications/notifications.testing';
import { VerificationService } from '../verification.service';

// @traces 300-FR-003 300-FR-004 300-FR-005 300-FR-006 300-FR-007 300-FR-009 300-FR-010 300-FR-011

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
const REASON = { code: 'documents_unreadable', note: 'The CUI is blurred' };
// A CUI whose control digit holds, and one whose does not.
const VALID_CUI = '1234567897';
const NAME = 'Auto Vest Motors SRL';

const memory = inMemory();
const started = startTelemetry(
  'api',
  { APP_ENV: 'test', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);
const counted = (kind: string, result: string) =>
  counterTotal(memory.metricReader, 'motorfix_verification_checks_total', {
    kind,
    result,
  });

// The day of the save as the admin's calendar reads it.
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
  }).format(new Date());

const checksService = (events: EventPort = outbox) =>
  new VerificationChecksService(new AuditService(), events);
const files = () =>
  new VerificationService(new AuditService(), outbox, {
    skipManualApproval: false,
  });

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
        body: error.getResponse() as { code?: string; message?: string },
        status: error.getStatus(),
      };
    }
    throw error;
  }
  throw new Error('the call was not refused');
}

let ioana: Actor;
let dan: Actor;
let mihai: Actor;
let garageId: string;
let fileId: string;

const record = (
  kind: string,
  body: {
    result: string;
    detail?: string;
    activities?: string[];
    evidence?: Record<string, unknown>;
  },
  actor: Actor = ioana,
  id = fileId,
) =>
  new VerificationChecksController(prisma, checksService()).record(
    actor,
    id,
    kind,
    body as never,
  );

const check = (
  kind: 'rar' | 'activities' | 'photos' | 'company' | 'caen' | 'representative',
) =>
  prisma.verificationCheck.findUniqueOrThrow({
    where: { fileId_kind: { fileId, kind } },
  });
const entries = () =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { garageId, subjectType: 'verification_check' },
  });
const recorded = () =>
  prisma.outboxEvent.findMany({
    orderBy: { createdAt: 'asc' },
    where: { kind: 'verification.check_recorded', subjectId: fileId },
  });

beforeEach(async () => {
  await reset();
  await prisma.outboxEvent.deleteMany();
  const garage = await prisma.garage.create({
    data: {
      businessKind: 'company',
      cui: VALID_CUI,
      name: 'Atelier Dinamo',
      slug: `dinamo-${randomUUID()}`,
    },
  });
  garageId = garage.id;
  ioana = person(await account('Ioana Popa', ['admin']), 'admin');
  dan = person(await account('Dan Ene', ['admin']), 'admin');
  mihai = person(await account('Mihai', ['garage']), 'garage', garageId);
  await prisma.garageMember.create({
    data: { accountId: mihai.accountId, garageId, role: 'owner' },
  });
  fileId = (await inTx((tx) => files().submit(tx, mihai, garageId))).id;
});

afterAll(async () => {
  await started?.shutdown();
  await prisma.$disconnect();
});

describe('recording a check', () => {
  it('saves the result with who and when, its history entry and its event', async () => {
    const before = Date.now();
    const detail = 'Autorizație găsită în registru, aceeași firmă și adresă';

    const answer = await record('rar', { detail, result: 'ok' });

    const rar = await check('rar');
    expect(rar).toMatchObject({
      automatic: false,
      detail,
      recordedBy: ioana.accountId,
      result: 'ok',
    });
    expect(rar.recordedAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect(answer.check).toMatchObject({ detail, id: rar.id, result: 'ok' });

    const [entry, ...more] = await entries();
    expect(more).toHaveLength(0);
    expect(entry).toMatchObject({
      action: 'update',
      actorId: ioana.accountId,
      field: 'rar',
      garageId,
      kind: 'verification_check_recorded',
      newValue: { detail, result: 'ok' },
      oldValue: { detail: null, result: 'not_run' },
      subjectId: rar.id,
    });

    const [event, ...others] = await recorded();
    expect(others).toHaveLength(0);
    expect(event).toMatchObject({
      audience: ['admin', 'system'],
      payload: { fileId, kind: 'rar', result: 'ok' },
      subjectId: fileId,
    });
  });

  it('answers with the file summary in both languages', async () => {
    await record('company', { evidence: { name: NAME }, result: 'ok' });
    const answer = await record('rar', { result: 'ok' });

    expect(answer.summary).toEqual({
      en: 'Company ID and RAR licence checked',
      ro: 'CUI și autorizație RAR verificate',
    });

    const warned = await record('photos', {
      detail: 'neclare',
      result: 'warning',
    });
    expect(warned.summary.ro).toBe(
      'CUI și autorizație RAR verificate · fotografii neclare',
    );
  });

  it('stores the activities on the garage in the same save', async () => {
    const answer = await record('activities', {
      activities: ['mechanics', 'brakes'],
      result: 'ok',
    });

    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: garageId },
    });
    expect(garage.rarActivities).toEqual(['mechanics', 'brakes']);
    expect(answer.rarActivities).toEqual(['mechanics', 'brakes']);
    const [entry] = await entries();
    expect(entry).toMatchObject({
      newValue: {
        activities: ['mechanics', 'brakes'],
        detail: null,
        result: 'ok',
      },
      oldValue: { activities: [], detail: null, result: 'not_run' },
    });
  });

  it('accepts an empty activities list when the result is ok', async () => {
    await record('activities', { activities: ['brakes'], result: 'ok' });
    await record('activities', { activities: [], result: 'ok' });

    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: garageId },
    });
    expect(garage.rarActivities).toEqual([]);
  });

  it('leaves the garage activities as they are when a problem comes without a list', async () => {
    await record('activities', { activities: ['brakes'], result: 'ok' });
    await record('activities', {
      detail: 'lipsește direcția',
      result: 'warning',
    });

    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: garageId },
    });
    expect(garage.rarActivities).toEqual(['brakes']);
    expect(await check('activities')).toMatchObject({ result: 'warning' });
    const [, kept] = await entries();
    expect(kept).toMatchObject({
      newValue: { activities: ['brakes'], result: 'warning' },
      oldValue: { activities: ['brakes'], result: 'ok' },
    });
  });

  // @traces 357-public-price-jobs-FR-006
  it('drops the public profile when the activities change, since they decide its jobs', async () => {
    const changed = () =>
      prisma.outboxEvent.findMany({
        where: { kind: 'price_list.updated', subjectId: garageId },
      });

    await record('activities', { activities: ['brakes'], result: 'ok' });

    const [event, ...others] = await changed();
    expect(others).toHaveLength(0);
    expect(event?.audience).toContain(`public:garage:${garageId}`);

    await record('activities', {
      detail: 'lipsește direcția',
      result: 'warning',
    });

    expect(await changed()).toHaveLength(1);
  });

  it('lets the last save win and keeps both in the history', async () => {
    await record('rar', { detail: 'nu apare', result: 'failed' });
    await record('rar', { detail: 'găsită', result: 'ok' }, dan);

    expect(await check('rar')).toMatchObject({
      detail: 'găsită',
      recordedBy: dan.accountId,
      result: 'ok',
    });
    const [first, second] = await entries();
    expect(first).toMatchObject({
      newValue: { detail: 'nu apare', result: 'failed' },
    });
    expect(second).toMatchObject({
      actorId: dan.accountId,
      newValue: { detail: 'găsită', result: 'ok' },
      oldValue: { detail: 'nu apare', result: 'failed' },
    });
    expect(await recorded()).toHaveLength(2);
  });

  it('replaces the detail with the one sent, or none', async () => {
    await record('representative', { detail: 'Același nume', result: 'ok' });
    await record('representative', { result: 'ok' });

    expect(await check('representative')).toMatchObject({ detail: null });
  });

  it('keeps two racing saves whole: each history entry starts from the other', async () => {
    await Promise.all([
      record('rar', { detail: 'a', result: 'warning' }),
      record('rar', { detail: 'b', result: 'failed' }, dan),
    ]);

    const [first, second] = await entries();
    expect(second?.oldValue).toEqual(first?.newValue);
    expect((await check('rar')).detail).toBe(
      (second?.newValue as { detail?: string } | undefined)?.detail,
    );
  });

  it('leaves no result, history or event when the event cannot be written', async () => {
    const failing: EventPort = {
      record: async () => {
        throw new Error('outbox down');
      },
    };

    await expect(
      inTx((tx) =>
        checksService(failing).record(tx, ioana, fileId, 'rar', {
          result: 'ok',
        }),
      ),
    ).rejects.toThrow('outbox down');

    expect(await check('rar')).toMatchObject({
      recordedBy: null,
      result: 'not_run',
    });
    expect(await entries()).toHaveLength(0);
    expect(await recorded()).toHaveLength(0);
  });
});

describe('a record that is refused', () => {
  const decide = async (
    outcome: 'approved' | 'rejected' | 'more_requested',
  ) => {
    await inTx((tx) => files().open(tx, ioana, fileId));
    await inTx((tx) =>
      files().decide(
        tx,
        ioana,
        fileId,
        outcome === 'approved' ? { outcome } : { outcome, reason: REASON },
      ),
    );
  };

  it.each(['approved', 'rejected', 'more_requested'] as const)(
    'is refused with 409 once the file is %s',
    async (outcome) => {
      await decide(outcome);

      expect(await refusal(record('rar', { result: 'ok' }))).toEqual({
        body: {
          code: 'verification_file_decided',
          message: 'Dosarul e deja decis',
        },
        status: 409,
      });
      expect(await entries()).toHaveLength(0);
    },
  );

  it('refuses a record that waited on a decision of the same file', async () => {
    await inTx((tx) => files().open(tx, ioana, fileId));
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let decided = () => {};
    const isDecided = new Promise<void>((resolve) => {
      decided = resolve;
    });
    const deciding = prisma.$transaction(async (tx) => {
      await files().decide(tx, dan, fileId, { outcome: 'approved' });
      decided();
      await held;
    });
    await isDecided;

    const recording = refusal(record('rar', { result: 'ok' }));
    // Long enough for a write that did not wait to have settled.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const waiting = await Promise.race([
      recording.then(() => 'settled'),
      Promise.resolve('waiting'),
    ]);
    expect(waiting).toBe('waiting');
    release();
    await deciding;

    expect(await recording).toMatchObject({ status: 409 });
    expect(await check('rar')).toMatchObject({ result: 'not_run' });
  });

  it('is accepted again once a decided file is reopened', async () => {
    await decide('rejected');
    await inTx((tx) => files().reopen(tx, dan, fileId));

    await record('rar', { result: 'ok' });

    expect(await check('rar')).toMatchObject({ result: 'ok' });
  });

  it('is accepted while the file is under review', async () => {
    await inTx((tx) => files().open(tx, ioana, fileId));

    await record('company', { evidence: { name: NAME }, result: 'ok' });

    expect(await check('company')).toMatchObject({ result: 'ok' });
  });

  it('refuses an unknown kind with 422', async () => {
    expect(await refusal(record('insurance', { result: 'ok' }))).toMatchObject({
      body: { code: 'verification_check_kind_unknown' },
      status: 422,
    });
  });

  it.each([
    ['a warning without a detail', 'photos', { result: 'warning' }],
    ['a failure without a detail', 'rar', { result: 'failed' }],
    ['a blank detail on a failure', 'rar', { detail: '   ', result: 'failed' }],
    [
      'a detail over 200 characters',
      'rar',
      { detail: 'x'.repeat(201), result: 'ok' },
    ],
    [
      'an unknown activity',
      'activities',
      { activities: ['mechanics', 'tuning'], result: 'ok' },
    ],
    [
      'a list on another kind',
      'rar',
      { activities: ['mechanics'], result: 'ok' },
    ],
    ['activities ok without a list', 'activities', { result: 'ok' }],
    ['a result that is not one', 'rar', { result: 'pending' }],
  ])('refuses %s with 400', async (_, kind, body) => {
    expect(await refusal(record(kind, body))).toMatchObject({
      body: { code: 'validation_failed' },
      status: 400,
    });
    expect(await entries()).toHaveLength(0);
  });

  it('accepts a detail of exactly 200 characters', async () => {
    await record('rar', { detail: 'x'.repeat(200), result: 'ok' });

    expect((await check('rar')).detail).toHaveLength(200);
  });

  it('answers 404 for an unknown or malformed file', async () => {
    for (const id of [randomUUID(), 'not-a-uuid']) {
      expect(
        await refusal(record('rar', { result: 'ok' }, ioana, id)),
      ).toMatchObject({ status: 404 });
    }
  });

  it('answers 404 to anyone but an admin', async () => {
    expect(await refusal(record('rar', { result: 'ok' }, mihai))).toMatchObject(
      { status: 404 },
    );
    expect(await check('rar')).toMatchObject({ result: 'not_run' });
  });
});

describe('the four tick results', () => {
  // @traces 302-FR-007
  it('records ok with no detail, as a tick does', async () => {
    await record('address', { result: 'ok' });

    expect(await check('photos')).toMatchObject({ result: 'not_run' });
    const address = await prisma.verificationCheck.findUniqueOrThrow({
      where: { fileId_kind: { fileId, kind: 'address' } },
    });
    expect(address).toMatchObject({ detail: null, result: 'ok' });
  });

  // @traces 302-FR-007
  it('records not_run with no detail, as an untick does, with its entry and event', async () => {
    await record('photos', { detail: 'Poze neclare', result: 'warning' });

    const answer = await record('photos', { result: 'not_run' });

    expect(answer.check).toMatchObject({ detail: null, result: 'not_run' });
    expect(await check('photos')).toMatchObject({
      detail: null,
      recordedBy: ioana.accountId,
      result: 'not_run',
    });
    const [, unticked] = await entries();
    expect(unticked).toMatchObject({
      kind: 'verification_check_recorded',
      newValue: { result: 'not_run' },
    });
    expect(await recorded()).toHaveLength(2);
  });

  // @traces 302-FR-007
  it.each([
    ['warning', 'Adresa diferă de certificat'],
    ['failed', 'Firma e radiată'],
  ])('records %s with its detail', async (result, detail) => {
    await record('representative', { detail, result });

    const row = await prisma.verificationCheck.findUniqueOrThrow({
      where: { fileId_kind: { fileId, kind: 'representative' } },
    });
    expect(row).toMatchObject({ detail, result });
  });

  // @traces 302-FR-007
  it.each([
    ['a detail', 'photos', { detail: 'x', result: 'not_run' }],
    ['a list', 'activities', { activities: ['brakes'], result: 'not_run' }],
  ])('refuses not_run with %s and writes nothing', async (_, kind, body) => {
    const answer = await refusal(record(kind, body));

    expect([answer.status, answer.body.code]).toEqual([
      400,
      'validation_failed',
    ]);
    expect(await entries()).toHaveLength(0);
  });
});

const garageIs = (data: Prisma.GarageUpdateInput) =>
  prisma.garage.update({ data, where: { id: garageId } });
const withCertificate = () =>
  prisma.legalDocument.create({
    data: {
      kind: 'onrc_certificate',
      pages: ['onrc/1.pdf'],
      verificationFileId: fileId,
    },
  });

describe('the company check', () => {
  // @traces 203-FR-001 203-FR-002 203-FR-004
  it('saves ok with the name, writing its own detail and the day of the look-up', async () => {
    const answer = await record('company', {
      detail: 'ce a scris adminul',
      evidence: { name: NAME },
      result: 'ok',
    });

    expect(await check('company')).toMatchObject({
      detail: `CUI valid · ${NAME}`,
      evidence: { lookedUpOn: today(), name: NAME },
      recordedBy: ioana.accountId,
      result: 'ok',
    });
    expect(answer.check).toMatchObject({
      evidence: { lookedUpOn: today(), name: NAME },
    });
    expect(answer.summary.ro).toBe('CUI verificat');
    const [entry, ...more] = await entries();
    expect(more).toHaveLength(0);
    expect(entry).toMatchObject({
      newValue: {
        detail: `CUI valid · ${NAME}`,
        evidence: { lookedUpOn: today(), name: NAME },
        result: 'ok',
      },
      oldValue: { detail: null, evidence: null, result: 'not_run' },
    });
    expect(await recorded()).toHaveLength(1);
  });

  // @traces 203-FR-002
  it.each([
    ['without a name', {}],
    ['with a name of spaces only', { name: '   ' }],
  ])('refuses ok %s with 400 and writes nothing', async (_, evidence) => {
    const answer = await refusal(record('company', { evidence, result: 'ok' }));

    expect([answer.status, answer.body.code]).toEqual([
      400,
      'validation_failed',
    ]);
    expect(await refusal(record('company', { result: 'ok' }))).toMatchObject({
      status: 400,
    });
    expect(await entries()).toHaveLength(0);
    expect(await recorded()).toHaveLength(0);
  });

  // @traces 203-FR-002
  it.each([
    ['no CUI', null],
    ['a CUI whose control digit fails', '1234567890'],
  ])('refuses ok when the garage has %s', async (_, cui) => {
    await garageIs({ cui });

    expect(
      await refusal(
        record('company', { evidence: { name: NAME }, result: 'ok' }),
      ),
    ).toMatchObject({ body: { code: 'validation_failed' }, status: 400 });
    expect(await check('company')).toMatchObject({ result: 'not_run' });
  });

  // @traces 203-FR-002
  it('records a warning with its typed detail and the name when given', async () => {
    await record('company', {
      detail: 'Firma e în insolvență',
      evidence: { name: NAME },
      result: 'warning',
    });

    expect(await check('company')).toMatchObject({
      detail: 'Firma e în insolvență',
      evidence: { lookedUpOn: today(), name: NAME },
      result: 'warning',
    });
    expect(
      await refusal(
        record('company', { evidence: { name: NAME }, result: 'failed' }),
      ),
    ).toMatchObject({ status: 400 });
  });

  // @traces 203-FR-004
  it('clears the result, the detail and the evidence when unticked, keeping the old evidence in the history', async () => {
    await record('company', { evidence: { name: NAME }, result: 'ok' });

    await record('company', { result: 'not_run' }, dan);

    expect(await check('company')).toMatchObject({
      detail: null,
      evidence: null,
      recordedBy: dan.accountId,
      result: 'not_run',
    });
    const [, unticked] = await entries();
    expect(unticked).toMatchObject({
      newValue: { detail: null, evidence: null, result: 'not_run' },
      oldValue: { evidence: { name: NAME }, result: 'ok' },
    });
  });

  // @traces 203-FR-001
  it.each([
    [
      'evidence on another kind',
      'rar',
      { evidence: { name: NAME }, result: 'ok' },
    ],
    [
      'evidence on an unticked check',
      'company',
      { evidence: { name: NAME }, result: 'not_run' },
    ],
    [
      'a CAEN tick on the company check',
      'company',
      { evidence: { name: NAME, onrc: true }, result: 'ok' },
    ],
    [
      'a name on the CAEN check',
      'caen',
      { evidence: { address: true, name: NAME, onrc: true }, result: 'ok' },
    ],
  ])('refuses %s with 400', async (_, kind, body) => {
    expect(await refusal(record(kind, body))).toMatchObject({
      body: { code: 'validation_failed' },
      status: 400,
    });
    expect(await entries()).toHaveLength(0);
  });

  // @traces 203-FR-004
  it('keeps no evidence when the event cannot be written', async () => {
    const failing: EventPort = {
      record: async () => {
        throw new Error('outbox down');
      },
    };

    await expect(
      inTx((tx) =>
        checksService(failing).record(tx, ioana, fileId, 'company', {
          evidence: { name: NAME },
          result: 'ok',
        } as never),
      ),
    ).rejects.toThrow('outbox down');

    expect(await check('company')).toMatchObject({
      evidence: null,
      result: 'not_run',
    });
  });
});

describe('the CAEN check', () => {
  const PREMISES =
    'Întreținerea și repararea autovehiculelor, la punctul de lucru';
  const SEAT = 'Întreținerea și repararea autovehiculelor, la sediul social';
  const TICKS = [false, true].flatMap((certificate) =>
    [false, true].flatMap((onrc) =>
      [false, true].map((address) => ({ address, certificate, onrc })),
    ),
  );
  const missing = (
    ticks: (typeof TICKS)[number],
    uploaded: boolean,
  ): string[] => [
    ...(uploaded && !ticks.certificate ? ['4520 pe certificat'] : []),
    ...(ticks.onrc ? [] : ['4520 în ONRC']),
    ...(ticks.address ? [] : ['adresa']),
  ];

  // @traces 203-FR-003
  it.each(
    [true, false].flatMap((uploaded) =>
      TICKS.map((ticks) => [uploaded, ticks] as const),
    ),
  )(
    'with a certificate uploaded %s, ticks %o save ok only when nothing is missing',
    async (uploaded, ticks) => {
      if (uploaded) await withCertificate();
      const absent = missing(ticks, uploaded);

      const saving = record('caen', { evidence: ticks, result: 'ok' });

      if (absent.length === 0) {
        await saving;
        expect(await check('caen')).toMatchObject({
          detail: PREMISES,
          evidence: {
            ...ticks,
            certificateUploaded: uploaded,
            lookedUpOn: today(),
          },
          result: 'ok',
        });
        return;
      }
      const answer = await refusal(saving);
      expect([answer.status, answer.body.code]).toEqual([
        400,
        'validation_failed',
      ]);
      for (const tick of absent) expect(answer.body.message).toContain(tick);
      expect(await entries()).toHaveLength(0);
    },
  );

  // @traces 203-FR-003
  it('reads the certificate from the file, never from the body', async () => {
    await record('caen', {
      evidence: { address: true, certificateUploaded: true, onrc: true },
      result: 'ok',
    });

    expect((await check('caen')).evidence).toMatchObject({
      certificateUploaded: false,
    });
  });

  // @traces 203-FR-003
  it('writes the seat wording for a mobile mechanic, whatever detail was sent', async () => {
    await garageIs({ businessKind: 'mobile' });

    await record('caen', {
      detail: 'altceva',
      evidence: { address: true, onrc: true },
      result: 'ok',
    });

    expect(await check('caen')).toMatchObject({ detail: SEAT });
  });

  // @traces 203-FR-003
  it('stores the ticks as sent on a warning, a missing one as false, and never promotes it', async () => {
    await withCertificate();

    await record('caen', {
      detail: 'Codul lipsește din certificat',
      evidence: { onrc: true },
      result: 'warning',
    });
    expect(await check('caen')).toMatchObject({
      detail: 'Codul lipsește din certificat',
      evidence: {
        address: false,
        certificate: false,
        certificateUploaded: true,
        onrc: true,
      },
      result: 'warning',
    });

    await record('caen', {
      detail: 'De verificat la ONRC',
      evidence: { address: true, certificate: true, onrc: true },
      result: 'failed',
    });
    expect(await check('caen')).toMatchObject({ result: 'failed' });
  });

  // @traces 203-FR-003
  it('keeps the evidence as recorded when a certificate arrives later', async () => {
    await record('caen', {
      evidence: { address: true, onrc: true },
      result: 'ok',
    });
    await withCertificate();

    expect((await check('caen')).evidence).toMatchObject({
      certificateUploaded: false,
    });
  });
});

describe('what a record reports', () => {
  // @traces 203-FR-010
  it('counts each record by kind and result, and a refusal not at all', async () => {
    const before = {
      company: await counted('company', 'ok'),
      rar: await counted('rar', 'warning'),
    };

    await record('rar', { detail: 'neclar', result: 'warning' });
    await record('company', { evidence: { name: NAME }, result: 'ok' });
    await refusal(record('company', { result: 'ok' }));

    expect((await counted('rar', 'warning')) - before.rar).toBe(1);
    expect((await counted('company', 'ok')) - before.company).toBe(1);
  });

  // @traces 203-FR-010
  it('logs one line with the file, the kind, the result and the admin, never the detail', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    await record('rar', { detail: 'Autorizație secretă', result: 'ok' });

    const lines = log.mock.calls.map((call) => String(call[0]));
    log.mockRestore();
    expect(lines).toHaveLength(1);
    for (const part of [fileId, 'rar', 'ok', ioana.accountId]) {
      expect(lines[0]).toContain(part);
    }
    expect(lines[0]).not.toContain('Autorizație secretă');
  });
});
