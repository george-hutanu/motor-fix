import type { DetailsSection, FieldProblem } from '@motor-fix/contracts';

import { GarageDetailsService } from './garage-details.service';
import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';
import {
  afterRace,
  refused,
} from '../prices/garage-prices/garage-prices.testing';

const { account, prisma } = fixtures();
const details = new GarageDetailsService(new AuditService());
serialDatabase(databaseUrl);

const section: DetailsSection = {
  businessKind: 'company',
  knownFor: '  Frâne și distribuție  ',
  name: '  Service Popescu ',
  phone: '0722 123 456',
};

let owner = '';
let since = new Date(0);

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE');
  const [{ now }] = await prisma.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  since = now;
  owner = await account('Mihai Ionescu', ['garage']);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const create = (given: DetailsSection) =>
  prisma.$transaction((tx) => details.create(tx, owner, given));

const history = () =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { at: { gte: since }, subjectType: 'garage' },
  });

async function nothingStored() {
  expect(await prisma.garage.count()).toBe(0);
  expect(await history()).toEqual([]);
}

describe('GarageDetailsService.create', () => {
  it('creates a draft garage from the step-1 section, texts trimmed and the phone as +40', async () => {
    const { id, slug } = await create(section);

    expect(
      await prisma.garage.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({
      businessKind: 'company',
      knownFor: 'Frâne și distribuție',
      mobileLegalForm: null,
      name: 'Service Popescu',
      phone: '+40722123456',
      slug: 'service-popescu',
      status: 'draft',
    });
    expect(slug).toBe('service-popescu');
  });

  it('keeps the legal form of a mobile service', async () => {
    const { id } = await create({
      ...section,
      businessKind: 'mobile',
      mobileLegalForm: 'pfa',
    });

    expect(
      await prisma.garage.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({ businessKind: 'mobile', mobileLegalForm: 'pfa' });
  });

  it('drops a legal form given for a service that is not mobile', async () => {
    const { id } = await create({ ...section, mobileLegalForm: 'pfa' });

    expect(
      await prisma.garage.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({ mobileLegalForm: null });
  });

  it('gives a second garage of the same name the next free slug', async () => {
    await create(section);
    await create(section);

    const third = await create({ ...section, name: 'SERVICE popescu' });

    expect(third.slug).toBe('service-popescu-3');
  });

  it('records one create entry as the owner, with the stored values, and no event', async () => {
    const outboxBefore = await prisma.outboxEvent.count();

    const { id, slug } = await create(section);

    expect(await history()).toEqual([
      expect.objectContaining({
        action: 'create',
        actorId: owner,
        actorRole: 'owner',
        garageId: id,
        newValue: {
          businessKind: 'company',
          knownFor: 'Frâne și distribuție',
          mobileLegalForm: null,
          name: 'Service Popescu',
          phone: '+40722123456',
          slug,
          status: 'draft',
        },
        subjectId: id,
      }),
    ]);
    expect(await prisma.outboxEvent.count()).toBe(outboxBefore);
  });

  it.each<[string, DetailsSection, FieldProblem[]]>([
    [
      'a one-letter name',
      { ...section, name: ' A ' },
      [{ code: 'length', field: 'name' }],
    ],
    [
      'a name over 80 characters',
      { ...section, name: 'x'.repeat(81) },
      [{ code: 'length', field: 'name' }],
    ],
    [
      'no name',
      { ...section, name: undefined },
      [{ code: 'length', field: 'name' }],
    ],
    [
      'no phone',
      { ...section, phone: undefined },
      [{ code: 'required', field: 'phone' }],
    ],
    [
      'a foreign phone',
      { ...section, phone: '+44 20 7946 0958' },
      [{ code: 'romanian', field: 'phone' }],
    ],
    [
      'a phone that is not a number',
      { ...section, phone: 'call me' },
      [{ code: 'romanian', field: 'phone' }],
    ],
    [
      'a blank known-for',
      { ...section, knownFor: '   ' },
      [{ code: 'length', field: 'knownFor' }],
    ],
    [
      'a known-for over 160 characters',
      { ...section, knownFor: 'x'.repeat(161) },
      [{ code: 'length', field: 'knownFor' }],
    ],
    [
      'no kind of business',
      { ...section, businessKind: undefined },
      [{ code: 'required', field: 'businessKind' }],
    ],
    [
      'a mobile service with no legal form',
      { ...section, businessKind: 'mobile' },
      [{ code: 'required', field: 'mobileLegalForm' }],
    ],
    [
      'everything missing at once',
      {},
      [
        { code: 'length', field: 'name' },
        { code: 'required', field: 'phone' },
        { code: 'required', field: 'knownFor' },
        { code: 'required', field: 'businessKind' },
      ],
    ],
  ])('refuses %s and stores nothing', async (_, given, expected) => {
    expect(await refused(create(given))).toEqual(expected);
    await nothingStored();
  });

  it('leaves nothing behind when the caller fails after the write', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await details.create(tx, owner, section);
        throw new Error('the listing could not be sent');
      }),
    ).rejects.toThrow('the listing could not be sent');

    await nothingStored();
  });

  it('refuses the loser of two sendings racing for one slug as a duplicate name', async () => {
    const errors = await afterRace(
      prisma,
      (tx) => details.create(tx, owner, section),
      () => refused(create(section)),
    );

    expect(errors).toEqual([{ code: 'duplicate', field: 'name' }]);
    expect(await prisma.garage.count()).toBe(1);
  });
});

// @traces 208-FR-007
describe('GarageDetailsService.update', () => {
  let garageId = '';
  const update = (given: DetailsSection) =>
    prisma.$transaction((tx) => details.update(tx, owner, garageId, given));
  const changes = async () =>
    (await history()).filter((entry) => entry.action === 'update');

  beforeEach(async () => {
    garageId = (await create(section)).id;
  });

  it('writes only the fields that differ, one history entry each with the old and new value', async () => {
    await update({
      ...section,
      knownFor: 'Distribuție',
      phone: '0733 000 111',
    });

    expect(
      await prisma.garage.findUniqueOrThrow({ where: { id: garageId } }),
    ).toMatchObject({
      knownFor: 'Distribuție',
      name: 'Service Popescu',
      phone: '+40733000111',
      slug: 'service-popescu',
    });
    expect(await changes()).toHaveLength(2);
    expect(await changes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: owner,
          actorRole: 'owner',
          field: 'phone',
          garageId,
          newValue: '+40733000111',
          oldValue: '+40722123456',
          subjectId: garageId,
        }),
        expect.objectContaining({
          field: 'knownFor',
          newValue: 'Distribuție',
          oldValue: 'Frâne și distribuție',
        }),
      ]),
    );
  });

  it('writes nothing for a section that only differs in spaces and the phone format', async () => {
    const before = await prisma.garage.findUniqueOrThrow({
      where: { id: garageId },
    });

    await update({
      ...section,
      name: 'Service Popescu',
      phone: '+40722123456',
    });

    expect(await changes()).toEqual([]);
    expect(
      await prisma.garage.findUniqueOrThrow({ where: { id: garageId } }),
    ).toEqual(before);
  });

  it('gives a renamed garage the slug of its new name', async () => {
    await update({ ...section, name: 'Atelier Nord' });

    expect(
      await prisma.garage.findUniqueOrThrow({ where: { id: garageId } }),
    ).toMatchObject({ name: 'Atelier Nord', slug: 'atelier-nord' });
    expect((await changes()).map((entry) => entry.field)).toEqual(['name']);
  });

  it('drops the legal form when the service stops being mobile', async () => {
    await update({
      ...section,
      businessKind: 'mobile',
      mobileLegalForm: 'pfa',
    });
    await update(section);

    expect(
      await prisma.garage.findUniqueOrThrow({ where: { id: garageId } }),
    ).toMatchObject({ businessKind: 'company', mobileLegalForm: null });
  });

  it('refuses a broken section and changes nothing', async () => {
    expect(await refused(update({ ...section, phone: 'call me' }))).toEqual([
      { code: 'romanian', field: 'phone' },
    ]);
    expect(await changes()).toEqual([]);
  });
});
