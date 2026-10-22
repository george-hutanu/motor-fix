import { HttpException } from '@nestjs/common';

import { CopyVoicesService } from './copy-voices.service';
import { AuditService } from '../../../audit/audit.service';
import type { Actor } from '../../../auth/policy';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { outbox } from '../../../events/event.port';
import {
  databaseUrl,
  fixtures,
} from '../../../notifications/notifications.testing';

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};

const voices = () => new CopyVoicesService(prisma, new AuditService(), outbox);

let ioana: Actor;

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return {
        code: (error.getResponse() as { code?: string }).code,
        status: error.getStatus(),
      };
    }
    throw error;
  }
  throw new Error('the call was not refused');
}

const stored = async () =>
  (await prisma.copyVoiceSetting.findMany({ orderBy: { voice: 'asc' } })).map(
    ({ enabled, pinned, voice }) => ({ enabled, pinned, voice }),
  );
const entries = () =>
  prisma.activityLog.findMany({
    orderBy: { field: 'asc' },
    where: { actorId: ioana.accountId, subjectType: 'copy_voice' },
  });
const events = () =>
  prisma.outboxEvent.findMany({
    where: { kind: 'platform_rule.changed', subjectId: 'copy_voices' },
  });

const ON = { enabled: true, pinned: false };
const OFF = { enabled: false, pinned: false };
const PINNED = { enabled: true, pinned: true };

const set = (voice: number, state: { enabled: boolean; pinned: boolean }) =>
  prisma.copyVoiceSetting.update({ data: state, where: { voice } });

beforeEach(async () => {
  await reset();
  await prisma.outboxEvent.deleteMany();
  await prisma.copyVoiceSetting.updateMany({
    data: { enabled: true, pinned: false, updatedAt: null, updatedBy: null },
  });
  ioana = {
    accountId: await account('Ioana Popa', ['admin']),
    garageId: null,
    permissions: NONE,
    role: 'admin',
    roles: ['admin'],
  };
});

afterAll(async () => {
  await prisma.copyVoiceSetting.updateMany({
    data: { enabled: true, pinned: false, updatedAt: null, updatedBy: null },
  });
  await prisma.$disconnect();
});

describe('the stored settings', () => {
  // @traces 010-FR-001
  it('holds five voices, all on and none pinned, as seeded', async () => {
    const list = await voices().list(ioana);

    expect(list.voices).toEqual(
      [1, 2, 3, 4, 5].map((voice) => ({
        enabled: true,
        pinned: false,
        updatedAt: null,
        voice,
      })),
    );
  });

  // @traces 010-FR-009
  it('reads publicly as the voices that are on and the pinned one', async () => {
    await set(2, OFF);
    await set(4, PINNED);

    expect(await voices().settings()).toEqual({
      enabled: [1, 3, 4, 5],
      pinned: 4,
    });
  });
});

describe('changing a voice', () => {
  // @traces 010-FR-003
  it('switches a voice off, keeps who and when, and answers the five', async () => {
    const list = await voices().change(ioana, 3, { ...OFF, seen: ON });

    expect(list.voices[2]).toMatchObject({ enabled: false, voice: 3 });
    expect(list.voices[2].updatedAt).toEqual(expect.any(String));
    const row = await prisma.copyVoiceSetting.findUniqueOrThrow({
      where: { voice: 3 },
    });
    expect(row.updatedBy).toBe(ioana.accountId);
  });

  // @traces 010-FR-003
  it.each([0, 6, Number.NaN])('answers 404 for voice %s', async (voice) => {
    expect(
      await refusal(voices().change(ioana, voice, { ...OFF, seen: ON })),
    ).toEqual({ code: 'not_found', status: 404 });
  });

  // @traces 010-FR-004
  it('refuses to switch the last voice off', async () => {
    for (const voice of [1, 2, 3, 4]) await set(voice, OFF);

    expect(
      await refusal(voices().change(ioana, 5, { ...OFF, seen: ON })),
    ).toEqual({ code: 'last_voice', status: 422 });
    expect((await stored())[4]).toEqual({ ...ON, voice: 5 });
  });

  // @traces 010-FR-005
  it('refuses to pin a voice that is off, or one switched off in the same change', async () => {
    await set(2, OFF);

    expect(
      await refusal(
        voices().change(ioana, 2, { enabled: false, pinned: true, seen: OFF }),
      ),
    ).toEqual({ code: 'voice_off', status: 422 });
    expect(
      await refusal(
        voices().change(ioana, 3, { enabled: false, pinned: true, seen: ON }),
      ),
    ).toEqual({ code: 'voice_off', status: 422 });
  });

  // @traces 010-FR-005
  it('refuses to switch the pinned voice off', async () => {
    await set(4, PINNED);

    expect(
      await refusal(
        voices().change(ioana, 4, {
          enabled: false,
          pinned: true,
          seen: PINNED,
        }),
      ),
    ).toEqual({ code: 'voice_pinned', status: 422 });
  });

  // @traces 010-FR-006
  it('moves the pin: pinning one voice unpins the other in the same change', async () => {
    await set(2, PINNED);

    await voices().change(ioana, 5, { ...PINNED, seen: ON });

    expect(await stored()).toEqual([
      { ...ON, voice: 1 },
      { ...ON, voice: 2 },
      { ...ON, voice: 3 },
      { ...ON, voice: 4 },
      { ...PINNED, voice: 5 },
    ]);
  });

  // @traces 010-FR-007
  it('answers 409 stale_value when the screen showed another state, before any rule', async () => {
    for (const voice of [1, 2, 3, 4]) await set(voice, OFF);

    expect(
      await refusal(voices().change(ioana, 5, { ...OFF, seen: OFF })),
    ).toEqual({ code: 'stale_value', status: 409 });
  });

  // @traces 010-FR-007
  it('answers the stored settings and writes nothing when nothing changes', async () => {
    const list = await voices().change(ioana, 1, { ...ON, seen: ON });

    expect(list.voices).toHaveLength(5);
    expect(await entries()).toHaveLength(0);
    expect(await events()).toHaveLength(0);
  });

  // @traces 010-FR-007
  it('serialises two admins changing the same voice: the second gets 409', async () => {
    const results = await Promise.allSettled([
      voices().change(ioana, 2, { ...OFF, seen: ON }),
      voices().change(ioana, 2, { ...OFF, seen: ON }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [failed] = results.filter((r) => r.status === 'rejected');
    expect(
      ((failed as PromiseRejectedResult).reason as HttpException).getStatus(),
    ).toBe(409);
  });

  // @traces 010-FR-008
  it('records one audit entry per changed voice and one event with the public settings', async () => {
    await set(2, PINNED);

    await voices().change(ioana, 5, { ...PINNED, seen: ON });

    const audit = await entries();
    expect(audit).toHaveLength(2);
    expect(audit.map((e) => [e.field, e.oldValue, e.newValue])).toEqual([
      ['2', PINNED, ON],
      ['5', ON, PINNED],
    ]);
    expect(audit[0]).toMatchObject({
      actorId: ioana.accountId,
      actorRole: 'admin',
      kind: 'copy_voice_changed',
    });
    const [event] = await events();
    expect(event.payload).toEqual({
      key: 'copy_voices',
      new: { enabled: [1, 2, 3, 4, 5], pinned: 5 },
      old: { enabled: [1, 2, 3, 4, 5], pinned: 2 },
    });
    expect(event.audience).toEqual(['admin', 'system']);
  });
});
