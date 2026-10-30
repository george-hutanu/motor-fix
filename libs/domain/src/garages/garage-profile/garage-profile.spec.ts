import { GarageProfileService } from './garage-profile.service';
import type { Actor } from '../../auth/policy';

// @traces 133-FR-002

const GARAGE = '7b0c9a52-2f7e-4d55-9a0f-0d6c1a0e5c11';
const PERMISSIONS = {
  canAnswerQuotes: true,
  canMoveBookings: true,
  canRecordFinalPrice: true,
};
const actor = (role: Actor['role'], garageId: string | null = GARAGE) =>
  ({
    accountId: 'a-1',
    garageId,
    permissions: PERMISSIONS,
    role,
    roles: [role],
  }) as Actor;

type Row = {
  phone: string | null;
  profileVersion: number;
  slug: string;
  closedDays?: { day: Date; note: string | null }[];
};

function service(row: Row | null) {
  const findUnique = jest.fn(async () => row && { closedDays: [], ...row });
  const bySlug = jest.fn(async (slug: string) => ({ name: 'Nord', slug }));
  const profile = new GarageProfileService(
    { garage: { findUnique } } as never,
    { bySlug } as never,
  );
  return { bySlug, findUnique, profile };
}

const status = (failure: unknown) =>
  (failure as { getStatus(): number }).getStatus();

describe("the staff read of a garage's own public profile, in order", () => {
  it('reads the public answer by the garage slug and adds the stored phone', async () => {
    const { bySlug, profile } = service({
      phone: '+40722123456',
      profileVersion: 0,
      slug: 'nord',
    });

    await expect(profile.read(actor('garage'), GARAGE)).resolves.toEqual({
      name: 'Nord',
      phone: '+40722123456',
      slug: 'nord',
      storedClosedDays: [],
      version: '0',
    });
    expect(bySlug).toHaveBeenCalledWith('nord');
  });

  // @traces 102-FR-006
  it('answers the receptionist as it answers the owner', async () => {
    const { profile } = service({
      phone: '+40722123456',
      profileVersion: 0,
      slug: 'nord',
    });

    await expect(profile.read(actor('receptionist'), GARAGE)).resolves.toEqual(
      await profile.read(actor('garage'), GARAGE),
    );
  });

  it('refuses the mechanic before reading the garage, even with every permission', async () => {
    const { findUnique, profile } = service({
      phone: null,
      profileVersion: 0,
      slug: 'nord',
    });

    const failure = await profile
      .read(actor('mechanic'), GARAGE)
      .catch((e) => e);

    expect(status(failure)).toBe(403);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['another garage', actor('garage', 'other')],
    ['no garage', actor('admin', null)],
  ])('answers 404 for %s without reading anything', async (_, who) => {
    const { findUnique, profile } = service({
      phone: null,
      profileVersion: 0,
      slug: 'nord',
    });

    const failure = await profile.read(who, GARAGE).catch((e) => e);

    expect(status(failure)).toBe(404);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('answers 404 when the row is gone between the check and the read', async () => {
    const { bySlug, profile } = service(null);

    const failure = await profile.read(actor('garage'), GARAGE).catch((e) => e);

    expect(status(failure)).toBe(404);
    expect(bySlug).not.toHaveBeenCalled();
  });

  // @traces 1246-FR-008
  it('carries the profile stamp as a string, read beside the phone', async () => {
    const { findUnique, profile } = service({
      phone: null,
      profileVersion: 7,
      slug: 'nord',
    });

    await expect(profile.read(actor('garage'), GARAGE)).resolves.toMatchObject({
      version: '7',
    });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ profileVersion: true }),
      }),
    );
  });

  // @traces 1246-FR-012
  it('carries every closed day the garage stored from today on, each with its note, for the hours dialog', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-30T22:30:00Z') });
    try {
      const { findUnique, profile } = service({
        closedDays: [
          { day: new Date('2026-12-27T00:00:00Z'), note: 'Inventar' },
          { day: new Date('2027-03-02T00:00:00Z'), note: null },
        ],
        phone: null,
        profileVersion: 0,
        slug: 'nord',
      });

      await expect(
        profile.read(actor('garage'), GARAGE),
      ).resolves.toMatchObject({
        storedClosedDays: [
          { day: '2026-12-27', note: 'Inventar' },
          { day: '2027-03-02' },
        ],
      });
      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            closedDays: {
              orderBy: { day: 'asc' },
              select: { day: true, note: true },
              where: { day: { gte: new Date('2026-10-31T00:00:00Z') } },
            },
          }),
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
