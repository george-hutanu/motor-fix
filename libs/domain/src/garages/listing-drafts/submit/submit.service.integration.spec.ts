import type { ListingDraftData, SurveySection } from '@motor-fix/contracts';
import { HttpException } from '@nestjs/common';

import { ListingSubmitService } from './submit.service';
import { AuditService } from '../../../audit/audit.service';
import { AccountsService } from '../../../auth/accounts.service';
import { newToken } from '../../../auth/email-confirmation/email-confirmation';
import type { Actor } from '../../../auth/policy';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { outbox } from '../../../events/event.port';
import {
  databaseUrl,
  fixtures,
} from '../../../notifications/notifications.testing';
import { GarageDetailsService } from '../../details/garage-details.service';
import { LegalDocumentsService } from '../../documents/legal-documents/legal-documents.service';
import { GarageMechanicsService } from '../../mechanics/garage-mechanics.service';
import { GaragePhotosService } from '../../photos/garage-photos.service';
import type { ListingPhotosService } from '../../photos/listing-photos/listing-photos.service';
import { GaragePlaceService } from '../../place/garage-place.service';
import { GaragePricesService } from '../../prices/garage-prices/garage-prices.service';
import { VerificationService } from '../../verification/verification.service';
import { ListingDraftsService } from '../listing-drafts.service';

const { account, prisma } = fixtures();
serialDatabase(databaseUrl);

const audit = new AuditService();
const legal = new LegalDocumentsService(prisma, audit, outbox, {} as never);
const photos = {
  describe: async (keys: string[]) =>
    keys.map((key) => ({ height: 600, key, width: 800 })),
} as unknown as ListingPhotosService;
const service = new ListingSubmitService(
  prisma,
  new ListingDraftsService(prisma, {} as never, { webUrl: '' } as never),
  new AccountsService(prisma, audit, outbox),
  new GarageDetailsService(audit),
  new GaragePricesService(audit, outbox),
  new GarageMechanicsService(audit),
  new GaragePlaceService(audit),
  new GaragePhotosService(audit),
  photos,
  new VerificationService(audit, outbox, { skipManualApproval: false }),
  legal,
  audit,
  outbox,
);

const PAGE = 'listing-documents/3f1b7d2a-6a43-4c55-9d1c-6f3f1b7d2a10/p1';
const PHOTO = 'garage-photos/3f1b7d2a-6a43-4c55-9d1c-6f3f1b7d2a10/p1';
const SURVEY: SurveySection = {
  foundVia: 'google',
  liftsCount: '1',
  mechanicsCount: '1-2',
  wantsDaySheets: false,
  wantsLiveMedia: true,
};

let dacia = '';
let brakes = '';
let since = new Date(0);

// What the test does is read from here on, its set-up left out. A Date
// holds milliseconds and the history microseconds, so the mark is the next
// millisecond, waited for.
async function mark() {
  const [{ now }] = await prisma.$queryRaw<{ now: Date }[]>`
    SELECT date_trunc('milliseconds', clock_timestamp()) + interval '1 millisecond' AS now`;
  await prisma.$executeRaw`SELECT pg_sleep(0.002)`;
  since = now;
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE account, brand, garage, job_type, listing_draft CASCADE',
  );
  dacia = (
    await prisma.brand.create({
      data: { key: 'dacia', name: 'Dacia', slug: 'dacia' },
    })
  ).id;
  brakes = (
    await prisma.jobType.create({
      data: {
        key: 'front-brakes',
        nameEn: 'Front brakes',
        nameRo: 'Frâne față',
        status: 'approved',
      },
    })
  ).id;
  await mark();
});
afterAll(() => prisma.$disconnect());

const complete = (cui = '18547290'): ListingDraftData => ({
  declaredAt: '2026-10-11T10:00:00.000Z',
  declaredByName: 'Ion Popescu',
  documents: {
    onrc_certificate: { pages: [PAGE] },
    rar_authorisation: { pages: [PAGE] },
  },
  files: [PHOTO],
  steps: {
    '1': {
      businessKind: 'company',
      knownFor: 'Frâne și distribuție',
      name: 'Service Popescu',
      phone: '0722 123 456',
    },
    '2': { brands: [{ brandId: dacia, name: 'Dacia', stance: 'works_on' }] },
    '3': {
      jobs: [
        { fromBani: 15_000, jobTypeId: brakes, toBani: 30_000 },
        { fromBani: 20_000, name: 'Recondiționare injectoare', toBani: 40_000 },
      ],
      labour: { fromBani: 12_000, toBani: 20_000 },
    },
    '4': { mechanics: [{ name: 'Mihai Ionescu' }], onProfile: true },
    '5': {
      payments: ['cash'],
      place: { address: 'Str. Lungă 1, Brașov', lat: 45.65, lng: 25.6 },
    },
    '6': { cui, rarNumber: 'BV-123' },
  },
  survey: SURVEY,
});

async function draft(data: ListingDraftData = complete()) {
  const key = newToken();
  const row = await prisma.listingDraft.create({
    data: {
      data: data as never,
      email: 'ana@service.ro',
      language: 'ro',
      step: 6,
      tokens: {
        create: { hash: key.hash, kind: 'browser', sentAt: new Date() },
      },
      updatedAt: new Date(),
    },
  });
  return { id: row.id, token: key.token };
}

async function driver(name = 'ana'): Promise<Actor> {
  const accountId = await account(name, ['driver']);
  await mark();
  return {
    accountId,
    garageId: null,
    permissions: {
      canAnswerQuotes: true,
      canMoveBookings: true,
      canRecordFinalPrice: true,
    },
    role: 'driver',
    roles: ['driver'],
  };
}

const refusalOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof HttpException)) throw error ?? new Error('sent');
  return {
    body: error.getResponse() as Record<string, unknown>,
    status: error.getStatus(),
  };
};

const eventsSince = (kind?: string) =>
  prisma.outboxEvent.findMany({
    where: { createdAt: { gte: since }, ...(kind && { kind }) },
  });

async function nothingCreated(accountId: string, draftId: string) {
  expect(
    await prisma.garage.count({ where: { name: 'Service Popescu' } }),
  ).toBe(0);
  expect(await prisma.verificationFile.count()).toBe(0);
  expect(await prisma.garageMember.count({ where: { accountId } })).toBe(0);
  expect(
    await prisma.accountRole.findMany({
      select: { role: true },
      where: { accountId },
    }),
  ).toEqual([{ role: 'driver' }]);
  expect(
    await prisma.activityLog.count({
      where: { actorId: accountId, at: { gte: since } },
    }),
  ).toBe(0);
  expect(await eventsSince()).toEqual([]);
  expect(
    await prisma.listingDraft.findUniqueOrThrow({ where: { id: draftId } }),
  ).toMatchObject({
    status: 'open',
    submitKey: null,
    submitResult: null,
    submittedAt: null,
  });
}

// @traces 116-FR-010
describe('sending a complete draft', () => {
  it('creates the garage, its owner, every step’s rows and the submitted file', async () => {
    const actor = await driver();
    const { id, token } = await draft();

    const sent = await service.submit(actor, id, token, 'key-1');

    expect(sent).toEqual({
      fileId: expect.any(String),
      garageId: expect.any(String),
      status: 'submitted',
      warnings: [],
    });
    const garage = await prisma.garage.findUniqueOrThrow({
      include: {
        brands: true,
        closedDays: true,
        features: true,
        mechanics: true,
        members: true,
        photos: true,
        prices: true,
        survey: true,
      },
      where: { id: sent.garageId },
    });
    expect(garage).toMatchObject({
      address: 'Str. Lungă 1, Brașov',
      businessKind: 'company',
      cui: '18547290',
      labourFromBani: 12_000,
      labourToBani: 20_000,
      name: 'Service Popescu',
      paymentCash: true,
      status: 'draft',
    });
    expect(garage.members).toEqual([
      expect.objectContaining({ accountId: actor.accountId, role: 'owner' }),
    ]);
    expect(garage.brands).toEqual([
      expect.objectContaining({ brandId: dacia, stance: 'works_on' }),
    ]);
    expect(garage.prices).toHaveLength(2);
    expect(garage.mechanics.map((m) => m.name)).toEqual(['Mihai Ionescu']);
    expect(garage.photos.map((p) => p.fileKey)).toEqual([PHOTO]);
    expect(garage.survey).toMatchObject(SURVEY);
    expect(garage.features).toHaveLength(5);
    const file = await prisma.verificationFile.findUniqueOrThrow({
      include: { documents: true },
      where: { id: sent.fileId },
    });
    expect(file).toMatchObject({
      cuiWarning: null,
      declaredByName: 'Ion Popescu',
      garageId: sent.garageId,
      rarNumber: 'BV-123',
      status: 'submitted',
    });
    expect(file.documents.map((d) => d.kind).sort()).toEqual([
      'onrc_certificate',
      'rar_authorisation',
    ]);
    expect(
      await prisma.listingDraft.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({
      status: 'submitted',
      submitKey: 'key-1',
      submitResult: sent,
      submittedAt: expect.any(Date),
    });
  });

  it('gives a signed-in driver the garage role on the same account', async () => {
    const actor = await driver();
    const { id, token } = await draft();
    const accounts = await prisma.account.count();

    await service.submit(actor, id, token, 'key-1');

    expect(await prisma.account.count()).toBe(accounts);
    expect(
      (
        await prisma.accountRole.findMany({
          where: { accountId: actor.accountId },
        })
      )
        .map((r) => r.role)
        .sort(),
    ).toEqual(['driver', 'garage']);
  });

  // @traces 116-FR-011
  it('hands the outbox its events and the history its entries, the owner as actor', async () => {
    const actor = await driver();
    const { id, token } = await draft();

    const sent = await service.submit(actor, id, token, 'key-1');

    const kinds = (await eventsSince()).map((e) => e.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'garage.created',
        'verification.submitted',
        'catalogue_job.proposed',
      ]),
    );
    expect(kinds).not.toContain('account.created');
    expect((await eventsSince('garage.created'))[0]).toMatchObject({
      payload: { accountId: actor.accountId, garageId: sent.garageId },
      subjectId: sent.garageId,
    });
    const entries = await prisma.activityLog.findMany({
      where: { at: { gte: since }, garageId: sent.garageId },
    });
    const types = new Set(entries.map((e) => e.subjectType));
    for (const type of [
      'garage',
      'garage_member',
      'garage_feature',
      'mechanic',
      'garage_photo',
      'verification_file',
      'legal_document',
    ]) {
      expect(types).toContain(type);
    }
    expect(
      entries.every(
        (e) => e.actorId === actor.accountId && e.actorRole === 'owner',
      ),
    ).toBe(true);
  });
});

// @traces 116-FR-010 116-FR-011
describe('a send that fails part-way', () => {
  it('leaves nothing: no garage, file, role, history, event or key', async () => {
    const actor = await driver();
    const { id, token } = await draft();
    const attach = jest
      .spyOn(legal, 'attach')
      .mockRejectedValueOnce(new Error('connection lost'));

    await expect(service.submit(actor, id, token, 'key-1')).rejects.toThrow(
      'connection lost',
    );

    attach.mockRestore();
    await nothingCreated(actor.accountId, id);
  });

  // @traces 116-FR-008
  it('keeps no key, so the same key sends it again', async () => {
    const actor = await driver();
    const { id, token } = await draft();
    const attach = jest
      .spyOn(legal, 'attach')
      .mockRejectedValueOnce(new Error('connection lost'));
    await service.submit(actor, id, token, 'key-1').catch(() => undefined);
    attach.mockRestore();

    const sent = await service.submit(actor, id, token, 'key-1');

    expect(sent.status).toBe('submitted');
    expect(await prisma.garage.count()).toBe(1);
  });
});

// @traces 116-FR-007
describe('the re-check', () => {
  it('refuses with 422 and the field list, the survey included, creating nothing', async () => {
    const actor = await driver();
    const data = complete();
    const { phone: _phone, ...details } = data.steps?.['1'] ?? {};
    const { id, token } = await draft({
      ...data,
      steps: { ...data.steps, '1': details },
      survey: { foundVia: 'google' },
    });

    const refused = await refusalOf(service.submit(actor, id, token, 'key-1'));

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({
      code: 'validation_failed',
      errors: [
        { code: 'required', field: 'steps.1.phone' },
        { code: 'required', field: 'survey' },
      ],
      warnings: [],
    });
    await nothingCreated(actor.accountId, id);
  });
});

// @traces 116-FR-008
describe('sending twice', () => {
  it('answers the first body to the same key and makes one garage', async () => {
    const actor = await driver();
    const { id, token } = await draft();

    const first = await service.submit(actor, id, token, 'key-1');
    const second = await service.submit(actor, id, token, 'key-1');

    expect(second).toEqual(first);
    expect(await prisma.garage.count()).toBe(1);
    expect(await prisma.verificationFile.count()).toBe(1);
  });

  it('refuses another key with 409 draft_already_submitted', async () => {
    const actor = await driver();
    const { id, token } = await draft();
    await service.submit(actor, id, token, 'key-1');

    const refused = await refusalOf(service.submit(actor, id, token, 'key-2'));

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'draft_already_submitted' });
    expect(await prisma.garage.count()).toBe(1);
  });

  it('answers two concurrent sends with the same key the same body', async () => {
    const actor = await driver();
    const { id, token } = await draft();

    const [first, second] = await Promise.all([
      service.submit(actor, id, token, 'key-1'),
      service.submit(actor, id, token, 'key-1'),
    ]);

    expect(second).toEqual(first);
    expect(await prisma.garage.count()).toBe(1);
    expect(await prisma.verificationFile.count()).toBe(1);
  });

  it('ends concurrent sends under two keys with one garage, the winning key answered alike and the other refused 409', async () => {
    const actor = await driver();
    const { id, token } = await draft();
    const keys = ['key-1', 'key-1', 'key-2'];

    const results = await Promise.allSettled(
      keys.map((key) => service.submit(actor, id, token, key)),
    );

    expect(await prisma.garage.count()).toBe(1);
    expect(await prisma.verificationFile.count()).toBe(1);
    const { submitKey } = await prisma.listingDraft.findUniqueOrThrow({
      where: { id },
    });
    const bodies = results.flatMap((r, i) =>
      keys[i] === submitKey && r.status === 'fulfilled' ? [r.value] : [],
    );
    expect(bodies).toHaveLength(keys.filter((k) => k === submitKey).length);
    for (const body of bodies) expect(body).toEqual(bodies[0]);
    const losers = results.filter((_, i) => keys[i] !== submitKey);
    expect(losers.length).toBeGreaterThan(0);
    for (const r of losers) {
      expect(r.status).toBe('rejected');
      const reason = (r as PromiseRejectedResult).reason as HttpException;
      expect(reason.getStatus()).toBe(409);
      expect(reason.getResponse()).toMatchObject({
        code: 'draft_already_submitted',
      });
    }
  });

  it('refuses a replay whose stored answer is not a send result with 409 draft_already_submitted', async () => {
    const actor = await driver();
    const { id, token } = await draft();
    await prisma.listingDraft.update({
      data: {
        status: 'submitted',
        submitKey: 'key-1',
        submitResult: { garageId: 42 },
        submittedAt: new Date(),
      },
      where: { id },
    });

    const refused = await refusalOf(service.submit(actor, id, token, 'key-1'));

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'draft_already_submitted' });
  });
});

// @traces 116-FR-009
describe('an account that already owns a garage', () => {
  it('is refused with 409 garage_already_exists, the draft left open', async () => {
    const actor = await driver();
    const held = await prisma.garage.create({
      data: { name: 'Atelier Vechi', slug: 'atelier-vechi' },
    });
    await prisma.garageMember.create({
      data: { accountId: actor.accountId, garageId: held.id, role: 'owner' },
    });
    const { id, token } = await draft();

    const refused = await refusalOf(service.submit(actor, id, token, 'key-1'));

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'garage_already_exists' });
    expect(await prisma.garage.count()).toBe(1);
    expect(
      await prisma.listingDraft.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({ status: 'open', submitKey: null });
  });

  it('refuses the second of two drafts sent at once with 409 garage_already_exists', async () => {
    const actor = await driver();
    const one = await draft();
    const other = await draft();

    const results = await Promise.allSettled([
      service.submit(actor, one.id, one.token, 'key-1'),
      service.submit(actor, other.id, other.token, 'key-2'),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const lost = results.find((r) => r.status === 'rejected');
    const reason = (lost as PromiseRejectedResult).reason as HttpException;
    expect(reason).toBeInstanceOf(HttpException);
    expect(reason.getStatus()).toBe(409);
    expect(reason.getResponse()).toMatchObject({
      code: 'garage_already_exists',
    });
    expect(await prisma.garage.count()).toBe(1);
    expect(
      await prisma.garageMember.count({
        where: { accountId: actor.accountId, role: 'owner' },
      }),
    ).toBe(1);
    expect(await prisma.listingDraft.count({ where: { status: 'open' } })).toBe(
      1,
    );
  });
});

// @traces 116-FR-012
describe('a CUI another listing holds', () => {
  it('sends anyway, naming the garage and the open draft on the file', async () => {
    const actor = await driver();
    await prisma.garage.create({
      data: {
        cui: '18547290',
        name: 'Atelier Vechi',
        slug: 'atelier-vechi',
        status: 'approved',
      },
    });
    const other = complete();
    await draft({
      ...other,
      steps: {
        ...other.steps,
        '1': { ...other.steps?.['1'], name: 'Service Rival' },
      },
    });
    const { id, token } = await draft();

    const sent = await service.submit(actor, id, token, 'key-1');

    expect(sent.warnings).toEqual([
      { code: 'cui_in_use', field: 'steps.6.cui' },
    ]);
    expect(
      await prisma.verificationFile.findUniqueOrThrow({
        where: { id: sent.fileId },
      }),
    ).toMatchObject({ cuiWarning: 'Atelier Vechi, Service Rival' });
  });
});
