import { randomUUID } from 'node:crypto';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { HttpException, Logger } from '@nestjs/common';

import { DRAFT_MAX_BYTES } from './listing-drafts';
import { ListingDraftsService } from './listing-drafts.service';
import { hashToken } from '../../auth/email-confirmation/email-confirmation';
import { serialDatabase } from '../../auth/serial-db.testing';
import type { NotificationsService } from '../../notifications/notifications.service';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

const reader = countedMetrics();
const signUps = () => counterTotal(reader, 'motorfix_garage_sign_ups_total');
const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const sent: { kind: string; draftId: string; link: string }[] = [];
let queueDown = false;
const notifications = {
  sendToDraft: async (kind: string, draftId: string, link: string) => {
    if (queueDown) throw new Error('queue down');
    sent.push({ draftId, kind, link });
  },
} as unknown as NotificationsService;

const service = new ListingDraftsService(prisma, notifications, {
  webUrl: 'https://motorfix.test',
} as never);

const body = (overrides: Record<string, unknown> = {}) => ({
  data: { steps: { '1': { name: 'Service Popescu' } } },
  email: 'owner@example.test',
  language: 'ro' as const,
  step: 1,
  ...overrides,
});

const tokenOf = (link: string) => new URL(link).searchParams.get('draft') ?? '';

const refusalOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof HttpException)) throw new Error('not refused');
  return { body: error.getResponse(), status: error.getStatus() };
};

beforeEach(async () => {
  sent.length = 0;
  queueDown = false;
  await reset();
});
afterAll(() => prisma.$disconnect());

describe('creating a draft', () => {
  it('keeps only the hashes of the browser key and the link token', async () => {
    const created = await service.create(body());

    const hashes = (await prisma.listingDraftToken.findMany()).map(
      (row) => row.hash,
    );
    const linkToken = tokenOf(sent[0]?.link ?? '');
    expect(created.token).toHaveLength(43);
    expect(linkToken).toHaveLength(43);
    expect(linkToken).not.toBe(created.token);
    expect(hashes.sort()).toEqual(
      [hashToken(created.token), hashToken(linkToken)].sort(),
    );
    expect(hashes).not.toContain(created.token);
    expect(hashes).not.toContain(linkToken);
  });

  it('queues one continue link in the draft language', async () => {
    const created = await service.create(body({ language: 'en' }));

    expect(created.linkSent).toBe(true);
    expect(sent).toEqual([
      {
        draftId: created.id,
        kind: 'LISTING_CONTINUE_LINK',
        link: expect.stringMatching(
          /^https:\/\/motorfix\.test\/en\/list-your-garage\?draft=[\w-]{43}$/,
        ),
      },
    ]);
  });

  it('keeps the draft and says no link went when the e-mail cannot be queued', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    queueDown = true;

    const created = await service.create(body());

    expect(created.linkSent).toBe(false);
    expect(created.token).toHaveLength(43);
    expect(await prisma.listingDraft.count()).toBe(1);
    expect(String(error.mock.calls[0]?.[0])).toContain(created.id);
    error.mockRestore();
  });

  // @traces 879-FR-009
  it('counts one garage sign-up per draft created, and none for a refused one', async () => {
    const before = await signUps();

    await service.create(body());
    await refusalOf(service.create(body({ email: 'not-an-email' })));

    expect(await signUps()).toBe(before + 1);
  });

  it('answers the saved draft with the time it was saved', async () => {
    const created = await service.create(body({ step: 2 }));

    expect(created).toMatchObject({
      email: 'owner@example.test',
      language: 'ro',
      status: 'open',
      step: 2,
    });
    const row = await prisma.listingDraft.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(created.updatedAt).toBe(row.updatedAt.toISOString());
  });

  it.each([
    'not-an-email',
    'a@b',
    'a b@example.test',
    `${'a'.repeat(250)}@example.test`,
  ])('refuses the address %s with a field error', async (email) => {
    const refused = await refusalOf(service.create(body({ email })));

    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({
      code: 'validation_failed',
      errors: [{ code: 'email_invalid', field: 'email' }],
    });
    expect(await prisma.listingDraft.count()).toBe(0);
  });

  it('refuses data that is not the draft envelope', async () => {
    const refused = await refusalOf(
      service.create(body({ data: { password: 'x' } })),
    );

    expect(refused.status).toBe(400);
    expect(await prisma.listingDraft.count()).toBe(0);
  });

  it('refuses data over the size limit with draft_too_large', async () => {
    const big = { survey: { note: 'x'.repeat(DRAFT_MAX_BYTES) } };

    const refused = await refusalOf(service.create(body({ data: big })));

    expect(refused.status).toBe(413);
    expect(refused.body).toMatchObject({ code: 'draft_too_large' });
    expect(await prisma.listingDraft.count()).toBe(0);
  });
});

describe('what a draft leaves behind', () => {
  it('stores no received key, writes no history or outbox event and logs no address or key', async () => {
    const logged: string[] = [];
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
      (level) =>
        jest
          .spyOn(Logger.prototype, level)
          .mockImplementation((...args: unknown[]) => {
            logged.push(args.map(String).join(' '));
          }),
    );
    const history = await prisma.activityLog.count();
    const events = await prisma.outboxEvent.count();

    const created = await service.create(body());
    const moved = await service.save(
      created.id,
      created.token,
      body({ email: 'maria@example.test', step: 2 }),
    );
    queueDown = true;
    await service.save(
      created.id,
      moved.token,
      body({ email: 'ion@example.test', step: 3 }),
    );

    const received = [
      created.token,
      moved.token,
      ...sent.map((s) => tokenOf(s.link)),
    ].filter((t): t is string => Boolean(t));
    const hashes = (await prisma.listingDraftToken.findMany()).map(
      (row) => row.hash,
    );
    for (const token of received) expect(hashes).not.toContain(token);
    expect(await prisma.activityLog.count()).toBe(history);
    expect(await prisma.outboxEvent.count()).toBe(events);
    const log = logged.join('\n');
    expect(log).toContain(created.id);
    for (const secret of [
      'owner@example.test',
      'maria@example.test',
      'ion@example.test',
      ...received,
    ])
      expect(log).not.toContain(secret);
    for (const spy of spies) spy.mockRestore();
  });
});

describe('reading a draft', () => {
  it('finds the draft from the link token alone', async () => {
    const created = await service.create(body());

    const draft = await service.current(tokenOf(sent[0]?.link ?? ''));

    expect(draft).toMatchObject({
      data: { steps: { '1': { name: 'Service Popescu' } } },
      email: 'owner@example.test',
      id: created.id,
      status: 'open',
      step: 1,
    });
  });

  it.each([
    ['a missing', undefined],
    ['an unknown', 'x'.repeat(43)],
  ])('answers %s token with not_found', async (_, token) => {
    await service.create(body());

    const refused = await refusalOf(service.current(token));

    expect(refused).toEqual({
      body: { code: 'not_found', message: 'No such draft' },
      status: 404,
    });
  });
});

describe('saving a draft', () => {
  it('replaces the whole data and sets the save time, merging nothing', async () => {
    const created = await service.create(
      body({
        data: { steps: { '1': { knownFor: 'Frâne', name: 'Service' } } },
      }),
    );

    const saved = await service.save(
      created.id,
      created.token,
      body({ data: { steps: { '2': { brandNote: 'Doar Dacia' } } }, step: 2 }),
    );

    const row = await prisma.listingDraft.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.data).toEqual({ steps: { '2': { brandNote: 'Doar Dacia' } } });
    expect(row.step).toBe(2);
    expect(saved.updatedAt).toBe(row.updatedAt.toISOString());
    expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(
      new Date(created.updatedAt).getTime(),
    );
    expect(saved.token).toBeUndefined();
  });

  it('answers not_found for a token of another draft', async () => {
    const mine = await service.create(body());
    const theirs = await service.create(body({ email: 'other@example.test' }));

    const refused = await refusalOf(
      service.save(theirs.id, mine.token, body()),
    );

    expect(refused.status).toBe(404);
    expect(refused.body).toEqual({
      code: 'not_found',
      message: 'No such draft',
    });
  });

  it('on a new address revokes every earlier token and returns a fresh key', async () => {
    const created = await service.create(body());
    const oldLink = tokenOf(sent[0]?.link ?? '');

    const saved = await service.save(
      created.id,
      created.token,
      body({ email: 'New@Example.test' }),
    );

    expect(saved.email).toBe('new@example.test');
    expect(saved.token).toHaveLength(43);
    expect(saved.linkSent).toBe(true);
    await expect(service.current(created.token)).rejects.toThrow();
    await expect(service.current(oldLink)).rejects.toThrow();
    await expect(service.current(saved.token)).resolves.toMatchObject({
      id: created.id,
    });
    expect(sent).toHaveLength(2);
  });

  it('keeps the tokens when the address is the same', async () => {
    const created = await service.create(body());

    const saved = await service.save(created.id, created.token, body());

    expect(saved.token).toBeUndefined();
    expect(sent).toHaveLength(1);
    await expect(service.current(created.token)).resolves.toBeDefined();
  });

  it('lets the later of two saves win', async () => {
    const created = await service.create(body());
    const link = tokenOf(sent[0]?.link ?? '');

    await service.save(created.id, created.token, body({ step: 3 }));
    await service.save(created.id, link, body({ step: 5 }));

    await expect(service.current(created.token)).resolves.toMatchObject({
      step: 5,
    });
  });

  it('takes two saves at once, keeping one of them whole', async () => {
    const created = await service.create(body());

    const results = await Promise.allSettled([
      service.save(created.id, created.token, body({ step: 2 })),
      service.save(created.id, created.token, body({ step: 4 })),
    ]);

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const { step } = await service.current(created.token);
    expect([2, 4]).toContain(step);
  });

  it('refuses a sent draft with draft_submitted but still reads it', async () => {
    const created = await service.create(body());
    await prisma.listingDraft.update({
      data: { status: 'submitted' },
      where: { id: created.id },
    });

    const refused = await refusalOf(
      service.save(created.id, created.token, body()),
    );

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'draft_submitted' });
    await expect(service.current(created.token)).resolves.toMatchObject({
      status: 'submitted',
    });
    await expect(
      refusalOf(service.sendLink(created.id, created.token)),
    ).resolves.toMatchObject({ status: 409 });
  });
});

describe('sending the link again', () => {
  it('sends five links an hour, then answers link_already_sent', async () => {
    const created = await service.create(body());
    for (let i = 0; i < 4; i++) {
      await service.sendLink(created.id, created.token);
    }

    const refused = await refusalOf(
      service.sendLink(created.id, created.token),
    );

    expect(sent).toHaveLength(5);
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ code: 'link_already_sent' });
    const wait = (refused.body as { retryAfterSeconds: number })
      .retryAfterSeconds;
    expect(wait).toBeGreaterThan(3500);
    expect(wait).toBeLessThanOrEqual(3600);
  });

  it('still saves past the cap and says no link went', async () => {
    const created = await service.create(body());
    for (let i = 0; i < 4; i++) {
      await service.sendLink(created.id, created.token);
    }

    const saved = await service.save(
      created.id,
      created.token,
      body({ email: 'next@example.test' }),
    );

    expect(saved.linkSent).toBe(false);
    expect(saved.token).toEqual(expect.any(String));
  });

  it('keeps counting the links of the hour across changes of address', async () => {
    const { id, token } = await service.create(body());
    let key = token;
    const sent: (boolean | undefined)[] = [];
    for (let i = 0; i < 6; i++) {
      const saved = await service.save(
        id,
        key,
        body({ email: `next${i}@example.test` }),
      );
      sent.push(saved.linkSent);
      key = saved.token ?? key;
    }

    expect(sent).toEqual([true, true, true, true, false, false]);
  });

  it('counts only the links of the past hour, not the reminder or the browser key', async () => {
    const created = await service.create(body());
    const hourAgo = new Date(Date.now() - 61 * 60 * 1000);
    await prisma.listingDraftToken.updateMany({
      data: { sentAt: hourAgo },
      where: { draftId: created.id },
    });
    await prisma.listingDraftToken.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        draftId: created.id,
        hash: `reminder-${i}`,
        kind: 'reminder' as const,
        sentAt: new Date(),
      })),
    });

    for (let i = 0; i < 5; i++) {
      await service.sendLink(created.id, created.token);
    }

    expect(sent).toHaveLength(6);
  });

  it('leaves the earlier links working until the address changes', async () => {
    const created = await service.create(body());
    await service.sendLink(created.id, created.token);
    const [first, second] = sent.map((s) => tokenOf(s.link));

    await expect(service.current(first ?? '')).resolves.toBeDefined();
    await expect(service.current(second ?? '')).resolves.toBeDefined();

    await service.save(
      created.id,
      created.token,
      body({ email: 'next@example.test' }),
    );

    await expect(
      refusalOf(service.current(first ?? '')),
    ).resolves.toMatchObject({ status: 404 });
  });

  it('answers the time of the send', async () => {
    const created = await service.create(body());
    const before = Date.now();

    const { sentAt } = await service.sendLink(created.id, created.token);

    expect(new Date(sentAt).getTime()).toBeGreaterThanOrEqual(before - 5);
  });

  it('cannot let two sends at once pass the fifth', async () => {
    const created = await service.create(body());
    for (let i = 0; i < 3; i++) {
      await service.sendLink(created.id, created.token);
    }

    const results = await Promise.allSettled([
      service.sendLink(created.id, created.token),
      service.sendLink(created.id, created.token),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(sent).toHaveLength(5);
  });
});

describe('the verification step of a draft', () => {
  const step6 = (section: unknown) =>
    body({ data: { steps: { '6': section } }, step: 6 });

  it('keeps the company tax ID and the RAR number and reads them back unchanged', async () => {
    const created = await service.create(body());
    const section = { cui: '18547290', rarNumber: 'AB 123/2020' };

    await service.save(created.id, created.token, step6(section));

    const draft = await service.current(tokenOf(sent[0]?.link ?? ''));
    expect(draft.data).toEqual({ steps: { '6': section } });
  });

  it('keeps what the owner typed even when it would not pass on sending', async () => {
    const created = await service.create(
      step6({ cui: '18547291', rarNumber: 'AB' }),
    );

    const row = await prisma.listingDraft.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.data).toEqual({
      steps: { '6': { cui: '18547291', rarNumber: 'AB' } },
    });
  });

  it.each([
    ['an unknown key', { companyName: 'SRL', cui: '18547290' }],
    ['a value that is not text', { cui: 18547290 }],
    ['a value of 41 characters', { rarNumber: 'X'.repeat(41) }],
    ['a section that is not an object', ['18547290']],
  ])('refuses %s with validation_failed', async (_, section) => {
    const created = await service.create(body());

    const refused = await refusalOf(
      service.save(created.id, created.token, step6(section)),
    );

    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: 'validation_failed' });
    const row = await prisma.listingDraft.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.data).toEqual(body().data);
  });

  it('accepts a save without the section', async () => {
    const created = await service.create(step6({ cui: '18547290' }));

    await service.save(created.id, created.token, body());

    const row = await prisma.listingDraft.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.data).toEqual(body().data);
  });

  it('writes nothing to the garages, the history or the outbox', async () => {
    const garages = await prisma.garage.count();
    const history = await prisma.activityLog.count();
    const events = await prisma.outboxEvent.count();

    const created = await service.create(step6({ cui: '18547290' }));
    await service.save(
      created.id,
      created.token,
      step6({ cui: '18547290', rarNumber: 'AB123' }),
    );

    expect(await prisma.garage.count()).toBe(garages);
    expect(await prisma.activityLog.count()).toBe(history);
    expect(await prisma.outboxEvent.count()).toBe(events);
  });
});

describe('the hours step of a draft', () => {
  const step5 = (section: unknown) =>
    body({ data: { steps: { '5': section } }, step: 5 });
  const hours = {
    fri: [['08:00', '17:00']],
    mon: [
      ['08:00', '12:00'],
      ['13:00', '17:00'],
    ],
    sat: [['09:00', '13:00']],
    sun: [],
    thu: [['08:00', '17:00']],
    tue: [['08:00', '17:00']],
    wed: [['08:00', '17:00']],
  };

  it('keeps the hours, the closed days and the facilities and reads them back unchanged', async () => {
    const created = await service.create(body());
    const section = {
      closedDays: [{ day: '2026-12-27', note: 'Inventar' }],
      facilities: ['waiting_area', 'courtesy_car'],
      hours,
    };

    await service.save(created.id, created.token, step5(section));

    const draft = await service.current(tokenOf(sent[0]?.link ?? ''));
    expect(draft.data).toEqual({ steps: { '5': section } });
  });

  it.each([
    [
      'a time off the quarter-hour grid',
      { hours: { ...hours, tue: [['08:10', '17:00']] } },
    ],
    [
      'a third interval',
      {
        hours: {
          ...hours,
          mon: [
            ['08:00', '10:00'],
            ['11:00', '12:00'],
            ['13:00', '17:00'],
          ],
        },
      },
    ],
    ['an unknown facility', { facilities: ['car_wash'] }],
    [
      'a note of 81 characters',
      { closedDays: [{ day: '2026-12-27', note: 'x'.repeat(81) }] },
    ],
    ['an unknown payment method', { payments: ['cheque'] }],
    ['a payment method twice', { payments: ['cash', 'cash'] }],
    [
      'a courtesy car with an extra key',
      { courtesyCar: { paid: false, seats: 5 } },
    ],
    [
      'a courtesy car price that is not a whole number',
      { courtesyCar: { paid: true, pricePerDayBani: 12000.5 } },
    ],
    [
      'a courtesy car price of 50 bani',
      { courtesyCar: { paid: true, pricePerDayBani: 50 } },
    ],
    [
      'a courtesy car price of 200,100 bani',
      { courtesyCar: { paid: true, pricePerDayBani: 200_100 } },
    ],
    [
      'a courtesy car price that is not whole lei',
      { courtesyCar: { paid: true, pricePerDayBani: 150 } },
    ],
  ])('refuses %s with validation_failed', async (_, section) => {
    const created = await service.create(body());

    const refused = await refusalOf(
      service.save(created.id, created.token, step5(section)),
    );

    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: 'validation_failed' });
    const row = await prisma.listingDraft.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.data).toEqual(body().data);
  });

  it.each([
    ['a section without the hours keys', {}],
    ["a section holding only other steps' keys", { photos: ['front.jpg'] }],
    ['a closed day already past', { closedDays: [{ day: '2020-01-01' }] }],
    [
      'the payment methods and a paid courtesy car',
      {
        courtesyCar: { paid: true, pricePerDayBani: 12000 },
        facilities: ['courtesy_car'],
        payments: ['cash', 'card', 'transfer'],
      },
    ],
    [
      'a courtesy car the facilities do not list',
      { courtesyCar: { paid: false }, facilities: [] },
    ],
  ])('accepts %s', async (_, section) => {
    const created = await service.create(body());

    await service.save(created.id, created.token, step5(section));

    const row = await prisma.listingDraft.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.data).toEqual({ steps: { '5': section } });
  });
});

describe('the brands step of a draft', () => {
  const step2 = (section: unknown) =>
    body({ data: { steps: { '2': section } }, step: 2 });
  const dacia = '6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f';
  const tesla = '0d9e8f7a-6b5c-4d3e-8f21-0a1b2c3d4e5f';
  const taken = (fuels?: unknown) => ({
    brands: [
      {
        brandId: dacia,
        name: 'Dacia',
        stance: 'works_on',
        ...(fuels === undefined ? {} : { fuels }),
      },
    ],
  });

  it('keeps the fuels of a taken brand and reads them back unchanged', async () => {
    const created = await service.create(body());
    const section = {
      ...taken(['petrol', 'diesel', 'hybrid']),
      brandNote: 'Fără mașini 100% electrice',
    };

    await service.save(created.id, created.token, step2(section));

    const draft = await service.current(tokenOf(sent[0]?.link ?? ''));
    expect(draft.data).toEqual({ steps: { '2': section } });
  });

  it.each([
    ['an unknown fuel', taken(['petrol', 'lpg'])],
    ['a fuel twice', taken(['diesel', 'diesel'])],
    [
      'fuels on a brand the garage does not take',
      {
        brands: [
          {
            brandId: tesla,
            fuels: ['electric'],
            name: 'Tesla',
            stance: 'does_not_take',
          },
        ],
      },
    ],
  ])('refuses %s with validation_failed', async (_, section) => {
    const created = await service.create(body());

    const refused = await refusalOf(
      service.save(created.id, created.token, step2(section)),
    );

    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: 'validation_failed' });
    const row = await prisma.listingDraft.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.data).toEqual(body().data);
  });

  it.each([
    ['a taken brand without fuels', taken()],
    ['a taken brand with every fuel unticked', taken([])],
  ])('accepts %s', async (_, section) => {
    const created = await service.create(body());

    await service.save(created.id, created.token, step2(section));

    const row = await prisma.listingDraft.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.data).toEqual({ steps: { '2': section } });
  });
});

describe('the place in step 5 of a draft', () => {
  const step5 = (section: unknown) =>
    body({ data: { steps: { '5': section } }, step: 5 });

  it('keeps the place beside the facilities and reads it back unchanged', async () => {
    const created = await service.create(body());
    const section = {
      facilities: ['waiting_area'],
      place: {
        address: 'Strada Ștefan cel Mare 12, Sector 2, București',
        lat: 44.4512,
        lng: 26.1207,
        radiusKm: 35,
      },
    };

    await service.save(created.id, created.token, step5(section));

    const draft = await service.current(tokenOf(sent[0]?.link ?? ''));
    expect(draft.data).toEqual({ steps: { '5': section } });
  });

  it.each([
    ['a latitude with no longitude', { lat: 44.45 }],
    ['a radius of 101 km', { radiusKm: 101 }],
    ['an address of 201 characters', { address: 'x'.repeat(201) }],
    ['a seat key', { seatAddress: 'Strada Sediului 3' }],
  ])('refuses a place with %s', async (_, place) => {
    const created = await service.create(body());

    const refused = await refusalOf(
      service.save(created.id, created.token, step5({ place })),
    );

    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: 'validation_failed' });
  });
});

describe('the documents of a draft', () => {
  // 2026-10-09 in Bucharest, still 2026-10-08 in UTC.
  const NOW = new Date('2026-10-08T22:30:00Z');
  const realNow = service.now;
  beforeEach(() => {
    service.now = () => NOW;
  });
  afterAll(() => {
    service.now = realNow;
  });

  type Documents = Record<string, { pages: string[]; issuedOn?: string }>;
  const page = (id: string) => `legal_document/${id}/${randomUUID()}`;

  // A draft holding the pages a confirm would have added.
  async function draftHolding(build: (id: string) => Documents) {
    const created = await service.create(body());
    const documents = build(created.id);
    await prisma.listingDraft.update({
      data: { data: { ...body().data, documents } },
      where: { id: created.id },
    });
    return { ...created, documents };
  }

  const pagesOf = (draft: { documents: Documents }, kind: string) =>
    draft.documents[kind]?.pages ?? [];

  const save = (
    draft: { id: string; token: string },
    data: Record<string, unknown>,
  ) =>
    service.save(
      draft.id,
      draft.token,
      body({ data: { ...body().data, ...data }, step: 6 }),
    );

  const documentsOf = async (id: string) => {
    const row = await prisma.listingDraft.findUniqueOrThrow({ where: { id } });
    return (row.data as { documents?: Documents }).documents;
  };

  // @traces 206-documents-declaration-FR-006
  it('keeps the page order the owner chose', async () => {
    const draft = await draftHolding((id) => ({
      onrc_certificate: { pages: [page(id), page(id), page(id)] },
    }));
    const [a, b, c] = pagesOf(draft, 'onrc_certificate') as [
      string,
      string,
      string,
    ];

    await save(draft, {
      documents: { onrc_certificate: { pages: [c, a, b] } },
    });

    expect(await documentsOf(draft.id)).toEqual({
      onrc_certificate: { pages: [c, a, b] },
    });
  });

  // @traces 206-documents-declaration-FR-006
  it('refuses a page the draft does not hold for that kind, and changes nothing', async () => {
    const draft = await draftHolding((id) => ({
      onrc_certificate: { pages: [page(id)] },
      rar_authorisation: { pages: [page(id)] },
    }));
    const other = await draftHolding((id) => ({
      rar_authorisation: { pages: [page(id)] },
    }));
    const certificate = pagesOf(draft, 'onrc_certificate');
    const authorisation = pagesOf(draft, 'rar_authorisation');

    for (const documents of [
      {
        rar_authorisation: {
          pages: [...authorisation, ...pagesOf(other, 'rar_authorisation')],
        },
      },
      { rar_authorisation: { pages: [page(draft.id)] } },
      // A page held, but under the other kind.
      { rar_authorisation: { pages: [...authorisation, ...certificate] } },
    ]) {
      const refused = await refusalOf(save(draft, { documents }));

      expect(refused.status).toBe(400);
      expect(refused.body).toMatchObject({ code: 'validation_failed' });
    }
    expect(await documentsOf(draft.id)).toEqual(draft.documents);
  });

  // @traces 206-documents-declaration-FR-006
  it('refuses a new draft that claims document pages', async () => {
    const other = await draftHolding((id) => ({
      rar_authorisation: { pages: [page(id)] },
    }));

    const refused = await refusalOf(
      service.create(
        body({
          data: { ...body().data, documents: other.documents },
          email: 'stranger@example.test',
        }),
      ),
    );

    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: 'validation_failed' });
    expect(await prisma.listingDraft.count()).toBe(1);
  });

  // @traces 206-documents-declaration-FR-006
  it('keeps a held page the save left out, at the end', async () => {
    const draft = await draftHolding((id) => ({
      rar_authorisation: { pages: [page(id), page(id), page(id)] },
    }));
    const [a, b, c] = pagesOf(draft, 'rar_authorisation') as [
      string,
      string,
      string,
    ];

    await save(draft, { documents: { rar_authorisation: { pages: [c, a] } } });

    expect(await documentsOf(draft.id)).toEqual({
      rar_authorisation: { pages: [c, a, b] },
    });
  });

  // @traces 206-documents-declaration-FR-006
  it('keeps the stored entry of a kind the save omits, and all of them when it carries none', async () => {
    const draft = await draftHolding((id) => ({
      onrc_certificate: { issuedOn: '2026-09-20', pages: [page(id)] },
      rar_authorisation: { pages: [page(id), page(id)] },
    }));
    const [a, b] = pagesOf(draft, 'rar_authorisation') as [
      string,
      string,
      string,
    ];

    await save(draft, { documents: { rar_authorisation: { pages: [b, a] } } });
    expect(await documentsOf(draft.id)).toEqual({
      onrc_certificate: draft.documents['onrc_certificate'],
      rar_authorisation: { pages: [b, a] },
    });

    await save(draft, {});
    expect(await documentsOf(draft.id)).toEqual({
      onrc_certificate: draft.documents['onrc_certificate'],
      rar_authorisation: { pages: [b, a] },
    });
  });

  // @traces 206-documents-declaration-FR-007
  it.each([
    ['today in Bucharest', '2026-10-09'],
    ['30 days before it', '2026-09-09'],
  ])('accepts an issue date of %s', async (_, issuedOn) => {
    const draft = await draftHolding((id) => ({
      onrc_certificate: { pages: [page(id)] },
    }));
    const pages = pagesOf(draft, 'onrc_certificate');

    await save(draft, { documents: { onrc_certificate: { issuedOn, pages } } });

    expect(await documentsOf(draft.id)).toEqual({
      onrc_certificate: { issuedOn, pages },
    });
  });

  // @traces 206-documents-declaration-FR-007
  it.each([
    ['31 days ago', '2026-09-08'],
    ['tomorrow in Bucharest', '2026-10-10'],
  ])('refuses an issue date of %s', async (_, issuedOn) => {
    const draft = await draftHolding((id) => ({
      onrc_certificate: { issuedOn: '2026-10-01', pages: [page(id)] },
    }));
    const pages = pagesOf(draft, 'onrc_certificate');

    const refused = await refusalOf(
      save(draft, { documents: { onrc_certificate: { issuedOn, pages } } }),
    );

    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: 'validation_failed' });
    expect(await documentsOf(draft.id)).toEqual(draft.documents);
  });

  // @traces 206-documents-declaration-FR-007
  it('keeps accepting a stored issue date that has aged past the window', async () => {
    const draft = await draftHolding((id) => ({
      onrc_certificate: { issuedOn: '2026-08-01', pages: [page(id)] },
    }));
    const stored = draft.documents['onrc_certificate'];

    await save(draft, { documents: { onrc_certificate: stored } });

    expect(await documentsOf(draft.id)).toEqual({ onrc_certificate: stored });
  });

  // @traces 206-documents-declaration-FR-017
  it('refuses a save with documents to a sent draft', async () => {
    const draft = await draftHolding((id) => ({
      onrc_certificate: { pages: [page(id)] },
    }));
    await prisma.listingDraft.update({
      data: { status: 'submitted' },
      where: { id: draft.id },
    });

    const refused = await refusalOf(
      save(draft, { documents: draft.documents }),
    );

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'draft_submitted' });
  });
});

describe('the declaration of a draft', () => {
  const FIRST = new Date('2026-10-09T08:00:00Z');
  const LATER = new Date('2026-10-09T09:15:00Z');
  const realNow = service.now;
  afterAll(() => {
    service.now = realNow;
  });
  const signed = () =>
    counterTotal(reader, 'motorfix_declarations_signed_total');

  const save = (
    draft: { id: string; token: string },
    data: Record<string, unknown>,
  ) =>
    service.save(
      draft.id,
      draft.token,
      body({ data: { ...body().data, ...data }, step: 6 }),
    );

  const declarationOf = async (id: string) => {
    const row = await prisma.listingDraft.findUniqueOrThrow({ where: { id } });
    const { declaredAt, declaredByName } = row.data as Record<string, unknown>;
    return { declaredAt, declaredByName };
  };

  // @traces 206-documents-declaration-FR-006
  // @traces 206-documents-declaration-FR-009
  it('stamps the server time on the save that adds the tick, whatever the browser sent, and counts it once', async () => {
    service.now = () => FIRST;
    const draft = await service.create(body());
    const before = await signed();

    await save(draft, {
      declaredAt: '1999-01-01T00:00:00.000Z',
      declaredByName: 'Ion Popescu',
    });

    expect(await declarationOf(draft.id)).toEqual({
      declaredAt: FIRST.toISOString(),
      declaredByName: 'Ion Popescu',
    });
    expect(await signed()).toBe(before + 1);
  });

  // @traces 206-documents-declaration-FR-006
  it('keeps the stored time on a save that keeps the tick, and counts nothing more', async () => {
    service.now = () => FIRST;
    const draft = await service.create(body());
    await save(draft, { declaredAt: 'ticked', declaredByName: 'Ion Popescu' });
    const before = await signed();

    service.now = () => LATER;
    await save(draft, {
      declaredAt: LATER.toISOString(),
      declaredByName: 'Ion Popescu',
    });

    expect(await declarationOf(draft.id)).toMatchObject({
      declaredAt: FIRST.toISOString(),
    });
    expect(await signed()).toBe(before);
  });

  // @traces 206-documents-declaration-FR-006
  it('clears the time on a save that drops the tick, and stamps anew on the next tick', async () => {
    service.now = () => FIRST;
    const draft = await service.create(body());
    await save(draft, { declaredAt: 'ticked', declaredByName: 'Ion Popescu' });

    await save(draft, { declaredByName: 'Ion Popescu' });
    expect(await declarationOf(draft.id)).toEqual({
      declaredAt: undefined,
      declaredByName: 'Ion Popescu',
    });

    service.now = () => LATER;
    await save(draft, { declaredAt: 'ticked', declaredByName: 'Ion Popescu' });
    expect(await declarationOf(draft.id)).toMatchObject({
      declaredAt: LATER.toISOString(),
    });
  });

  // @traces 206-documents-declaration-FR-006
  it('stamps a new draft that arrives ticked with the server time', async () => {
    service.now = () => FIRST;
    const before = await signed();

    const draft = await service.create(
      body({ data: { declaredAt: '1999-01-01T00:00:00.000Z' } }),
    );

    expect(await declarationOf(draft.id)).toMatchObject({
      declaredAt: FIRST.toISOString(),
    });
    expect(await signed()).toBe(before + 1);
  });

  // @traces 206-documents-declaration-FR-009
  it('keeps the name trimmed', async () => {
    const draft = await service.create(body());

    await save(draft, { declaredByName: '  Ion Popescu  ' });

    expect(await declarationOf(draft.id)).toMatchObject({
      declaredByName: 'Ion Popescu',
    });
  });

  // @traces 206-documents-declaration-FR-009
  it.each([
    ['over 80 characters', 'a'.repeat(81)],
    ['one character once trimmed', '  I  '],
    ['blank', '    '],
  ])('refuses a name %s, and changes nothing', async (_, name) => {
    const draft = await service.create(body());
    const before = await signed();

    const refused = await refusalOf(
      save(draft, { declaredAt: 'ticked', declaredByName: name }),
    );

    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: 'validation_failed' });
    expect(await declarationOf(draft.id)).toEqual({
      declaredAt: undefined,
      declaredByName: undefined,
    });
    expect(await signed()).toBe(before);
  });
});
