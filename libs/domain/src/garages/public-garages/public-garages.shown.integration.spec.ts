import { randomUUID } from 'node:crypto';

import { isShownOnProfile, shownOnProfile } from './public-garages';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

beforeEach(() => reset());

afterAll(async () => {
  await prisma.$disconnect();
});

type Row = {
  approved: boolean;
  feature: boolean;
  joined: boolean;
  onProfile: boolean;
  team: boolean;
};

// Every combination of the five conditions, 32 rows.
const ROWS: Row[] = Array.from({ length: 32 }, (_, n) => ({
  approved: Boolean(n & 1),
  feature: Boolean(n & 2),
  joined: Boolean(n & 4),
  onProfile: Boolean(n & 8),
  team: Boolean(n & 16),
}));

const label = (row: Row) =>
  Object.entries(row)
    .map(([key, on]) => `${key} ${on ? 'on' : 'off'}`)
    .join(', ');

// One garage and one card per row; `removedWithAccount` keeps the account on
// a removed card, which a removal never leaves but the rule must still refuse.
async function seed(row: Row, removedWithAccount = false) {
  const garage = await prisma.garage.create({
    data: {
      name: 'Atelier',
      slug: `atelier-${randomUUID()}`,
      status: row.approved ? 'approved' : 'draft',
      teamOnProfile: row.team,
    },
  });
  if (!row.feature) {
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: garage.id, key: 'team_mechanics' },
    });
  }
  const accountId =
    row.joined || removedWithAccount
      ? await account(`m-${randomUUID().slice(0, 8)}`, ['mechanic'])
      : null;
  const card = await prisma.mechanic.create({
    data: {
      accountId,
      garageId: garage.id,
      name: 'Tudor Vlad',
      onProfile: row.onProfile,
      removedAt: removedWithAccount ? new Date() : null,
    },
  });
  return { card, garage };
}

const viaWhere = async (id: string) =>
  (
    await prisma.mechanic.findMany({
      select: { id: true },
      where: { id, ...shownOnProfile() },
    })
  ).length === 1;

const viaPredicate = async (id: string) => {
  const card = await prisma.mechanic.findUniqueOrThrow({
    include: { garage: { include: { features: true } } },
    where: { id },
  });
  return isShownOnProfile(card, {
    status: card.garage.status,
    teamMechanics: !card.garage.features.some(
      (f) => f.key === 'team_mechanics' && !f.enabled,
    ),
    teamOnProfile: card.garage.teamOnProfile,
  });
};

// @traces 059-FR-001
describe('who is shown on the profile', () => {
  it.each(ROWS.map((row) => [label(row), row] as const))(
    '%s',
    async (_, row) => {
      const { card } = await seed(row);
      const expected = Object.values(row).every(Boolean);

      expect(await viaPredicate(card.id)).toBe(expected);
      expect(await viaWhere(card.id)).toBe(expected);
    },
  );

  it('never shows a removed card, even one that kept its account', async () => {
    const all = {
      approved: true,
      feature: true,
      joined: false,
      onProfile: true,
      team: true,
    };
    const { card } = await seed(all, true);

    expect(await viaPredicate(card.id)).toBe(false);
    expect(await viaWhere(card.id)).toBe(false);
  });

  it('never shows a card the owner typed before its mechanic accepted', async () => {
    const { card } = await seed({
      approved: true,
      feature: true,
      joined: false,
      onProfile: false,
      team: true,
    });

    expect(await viaPredicate(card.id)).toBe(false);
    expect(await viaWhere(card.id)).toBe(false);
  });

  it('counts a garage with no feature row as having the team on', async () => {
    const { card, garage } = await seed({
      approved: true,
      feature: true,
      joined: true,
      onProfile: true,
      team: true,
    });

    expect(
      await prisma.garageFeature.count({ where: { garageId: garage.id } }),
    ).toBe(0);
    expect(await viaWhere(card.id)).toBe(true);
  });
});
