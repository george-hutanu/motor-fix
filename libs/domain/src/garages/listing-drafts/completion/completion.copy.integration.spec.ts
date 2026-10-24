import { DEFAULT_HOURS, type ListingDraftData } from '@motor-fix/contracts';

import { copyOf, heldOf } from './completion.copy';
import { completionWorld } from './completion.testing';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { localDay } from '../../../bucharest';
import {
  databaseUrl,
  fixtures,
} from '../../../notifications/notifications.testing';

const { account, prisma } = fixtures();
serialDatabase(databaseUrl);
const { full, listed, plain, reset, world } = completionWorld(prisma);

const DAY_MS = 24 * 60 * 60 * 1000;
let day = '';
// A day from ten days on that is no public holiday, so the hours writer
// keeps it.
async function firstWorkingDay() {
  for (let ahead = 10; ; ahead += 1) {
    const candidate = localDay(new Date(Date.now() + ahead * DAY_MS));
    const holiday = await prisma.publicHoliday.findUnique({
      where: { day: new Date(candidate) },
    });
    if (!holiday) return candidate;
  }
}
const closedDay = () => day;

beforeEach(async () => {
  await reset();
  day = await firstWorkingDay();
});
afterAll(() => prisma.$disconnect());

// @traces 208-FR-004 208-FR-019
describe('the copy of a live garage', () => {
  it('reads every answer back into the form, photos in their order', async () => {
    const sent = full(closedDay());
    const garage = await listed(account, 'ion', sent);

    const copy = await copyOf(prisma, garage.garageId);

    expect(copy).toEqual({ ...sent, documents: {} });
  });

  // @traces 056-FR-006 056-FR-015
  it("leaves the owner's own row and a removed card out of the team step", async () => {
    const sent = full(closedDay());
    const garage = await listed(account, 'ion', sent);
    await prisma.mechanic.create({
      data: {
        garageId: garage.garageId,
        name: 'Elena Plecată',
        onProfile: false,
        removedAt: new Date(),
      },
    });

    const copy = await copyOf(prisma, garage.garageId);

    expect(
      await prisma.mechanic.count({
        where: { garageId: garage.garageId, isOwner: true },
      }),
    ).toBe(1);
    expect(copy.steps?.['4']).toEqual(sent.steps?.['4']);
  });

  it('writes the stored values, the defaults the writers filled in included', async () => {
    const sent = plain();
    const garage = await listed(account, 'ana', sent);

    const copy = await copyOf(prisma, garage.garageId);

    expect(copy.steps?.['1']).toEqual({
      businessKind: 'company',
      knownFor: 'Frâne și distribuție',
      name: 'Service Popescu',
      phone: '+40722123456',
    });
    expect(copy.steps?.['2']).toEqual({
      brands: [{ brandId: world.dacia, name: 'Dacia', stance: 'works_on' }],
    });
    expect(copy.steps?.['5']).toEqual({
      hours: DEFAULT_HOURS,
      payments: ['cash'],
      place: { address: 'Str. Lungă 1, Brașov', lat: 45.65, lng: 25.6 },
    });
    expect(copy.files).toEqual(sent.files);
    expect(copy.steps?.['6']).toEqual({ cui: '18547290', rarNumber: 'BV-123' });
    expect(copy.declaredByName).toBe('Ion Popescu');
  });

  it('is the same copy once sent again as a listing of its own', async () => {
    const first = await listed(account, 'ion', full(closedDay()));
    const copy = await copyOf(prisma, first.garageId);
    const documents: ListingDraftData['documents'] = {
      onrc_certificate: {
        issuedOn: '2026-09-01',
        pages: [`listing-documents/${first.garageId}/p9`],
      },
      rar_authorisation: { pages: [`listing-documents/${first.garageId}/p8`] },
    };
    // A photo belongs to one garage, so the first gives way before the second
    // is written over the same keys.
    await prisma.garage.delete({ where: { id: first.garageId } });

    const second = await listed(account, 'ana', { ...copy, documents });

    expect(await copyOf(prisma, second.garageId)).toEqual(copy);
  });

  it('lists one entry per current document of the file', async () => {
    const garage = await listed(account, 'ion', full(closedDay()));
    const onrc = await prisma.legalDocument.findFirstOrThrow({
      where: { kind: 'onrc_certificate', verificationFileId: garage.fileId },
    });
    await prisma.legalDocument.create({
      data: {
        kind: 'onrc_certificate',
        pages: ['listing-documents/old/p1'],
        replacedAt: new Date(),
        verificationFileId: garage.fileId,
      },
    });

    const held = await heldOf(prisma, garage.fileId);

    expect(held).toEqual([
      { issuedOn: '2026-09-01', kind: 'onrc_certificate', pages: 2 },
      { issuedOn: null, kind: 'rar_authorisation', pages: 1 },
    ]);
    expect(onrc.replacedAt).toBeNull();
  });
});
