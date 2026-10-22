import { CreateListingDraftDto } from '@motor-fix/contracts';
import { plainToInstance } from 'class-transformer';

import { ListingDraftsService } from './listing-drafts.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import type { NotificationsService } from '../../notifications/notifications.service';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const notifications = {
  sendToDraft: async () => undefined,
} as unknown as NotificationsService;
const service = new ListingDraftsService(prisma, notifications, {
  webUrl: 'https://motorfix.test',
} as never);

const base = {
  data: { steps: { '1': { name: 'Service Popescu' } } },
  email: 'owner@example.test',
  language: 'ro',
  step: 1,
};

// What the controller hands the service: the body after the DTO's transform.
const create = (extra: Record<string, unknown> = {}) =>
  service.create(plainToInstance(CreateListingDraftDto, { ...base, ...extra }));

const voiceOf = async (id: string) =>
  (await prisma.listingDraft.findUniqueOrThrow({ where: { id } })).copyVoice;

beforeEach(reset);
afterAll(() => prisma.$disconnect());

// @traces 009-FR-007
describe('the copy voice of a listing draft', () => {
  it.each([1, 3, 5])('stores %p', async (copyVoice) => {
    const created = await create({ copyVoice });

    expect(await voiceOf(created.id)).toBe(copyVoice);
  });

  it.each([0, 6, 7, -1, 2.5, '3', 'x', null, [3], {}])(
    'stores no voice for %p and still creates the draft',
    async (copyVoice) => {
      const created = await create({ copyVoice });

      expect(await voiceOf(created.id)).toBeNull();
    },
  );

  it('stores no voice when none is sent', async () => {
    expect(await voiceOf((await create()).id)).toBeNull();
  });

  it('answers the same whatever the voice, apart from ids and times', async () => {
    const without = await create();
    const bad = await create({ copyVoice: 7 });

    const shape = ({ id: _id, token: _token, ...rest }: typeof without) => ({
      ...rest,
      savedAt: undefined,
      updatedAt: undefined,
    });
    expect(Object.keys(bad).sort()).toEqual(Object.keys(without).sort());
    expect(shape(bad)).toEqual(shape(without));
  });

  it('keeps the voice through saves', async () => {
    const created = await create({ copyVoice: 4 });

    await service.save(created.id, created.token, {
      ...base,
      copyVoice: 2,
      data: { steps: { '1': { name: 'Altul' } } },
      step: 2,
    } as never);

    expect(await voiceOf(created.id)).toBe(4);
  });

  it('does not give a voiceless draft one through a later save', async () => {
    const created = await create();

    await service.save(created.id, created.token, {
      ...base,
      copyVoice: 2,
    } as never);

    expect(await voiceOf(created.id)).toBeNull();
  });
});
