// @traces 879-FR-018 879-FR-020
import {
  AdminOverviewController,
  observabilityUrl,
} from './admin-overview.controller';
import {
  countGarages,
  suspendedGarages,
} from './verification/suspension/suspended-garages';
import type { VerificationService } from './verification/verification.service';
import type { PrismaClient } from '../generated/prisma/client';
import {
  cities,
  countPlatformFigures,
  monthStartSnapshot,
  readGrowth,
  snapshotActiveDrivers,
} from '../insights/platform-figures';

jest.mock('./verification/suspension/suspended-garages', () => ({
  countGarages: jest.fn(),
  suspendedGarages: jest.fn(),
}));
jest.mock('../insights/platform-figures', () => ({
  cities: jest.fn(),
  countPlatformFigures: jest.fn(),
  monthStartSnapshot: jest.fn(),
  readGrowth: jest.fn(),
  snapshotActiveDrivers: jest.fn(),
}));

const prisma = {} as PrismaClient;
const figures = jest.mocked(countPlatformFigures);
const monthStart = jest.mocked(monthStartSnapshot);
const growth = jest.mocked(readGrowth);
const periodStart = jest.mocked(snapshotActiveDrivers);
const CITIES = [
  { garages: 214, key: 'all', name: 'România' },
  { garages: 3, key: 'cluj-napoca', name: 'Cluj-Napoca' },
];

const controller = (waiting: number, observabilityUrl?: string) => {
  const countWaiting = jest.fn(async (_db: unknown, _city?: string) => waiting);
  const verification = { countWaiting } as unknown as VerificationService;
  return {
    countWaiting,
    overview: new AdminOverviewController(
      prisma,
      verification,
      observabilityUrl,
    ),
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  figures.mockResolvedValue({
    activeDrivers: 12480,
    answerRate: 66,
    bookings: 17,
    garagesApprovedThisMonth: 9,
    garagesListed: 214,
    requestsSent: 48,
  });
  monthStart.mockResolvedValue(undefined);
  periodStart.mockResolvedValue(undefined);
  jest.mocked(cities).mockResolvedValue(CITIES);
});

// @traces 163-FR-001 163-FR-002 163-FR-004
describe('the admin overview route', () => {
  it('answers the number of garages waiting, counted on the database', async () => {
    const { countWaiting, overview } = controller(4);

    await expect(overview.overview({})).resolves.toMatchObject({
      garagesWaiting: 4,
    });
    expect(countWaiting).toHaveBeenCalledWith(prisma);
  });

  it('answers the platform figures beside the garages waiting, with no month-start value when there is no row', async () => {
    const { overview } = controller(2);

    const answer = await overview.overview({});

    expect(answer).toEqual({
      activeDrivers: 12480,
      answerRate: 66,
      bookings: 17,
      cities: CITIES,
      garagesApprovedThisMonth: 9,
      garagesListed: 214,
      garagesWaiting: 2,
      requestsSent: 48,
    });
    expect(Object.keys(answer)).not.toContain('activeDriversMonthStart');
  });

  it('carries the active drivers of the first of the month when its row exists', async () => {
    monthStart.mockResolvedValue(12168);
    const { overview } = controller(2);

    await expect(overview.overview({})).resolves.toEqual({
      activeDrivers: 12480,
      activeDriversMonthStart: 12168,
      answerRate: 66,
      bookings: 17,
      cities: CITIES,
      garagesApprovedThisMonth: 9,
      garagesListed: 214,
      garagesWaiting: 2,
      requestsSent: 48,
    });
  });

  it('counts the figures on the database at the moment of the call', async () => {
    const { overview } = controller(0);
    const before = Date.now();

    await overview.overview({});

    const [db, at] = figures.mock.calls[0];
    expect(db).toBe(prisma);
    expect(at.getTime()).toBeGreaterThanOrEqual(before);
    expect(at.getTime()).toBeLessThanOrEqual(Date.now());
    expect(monthStart).toHaveBeenCalledWith(prisma, at);
  });

  it('counts the chosen city and keeps the platform total of garages waiting', async () => {
    monthStart.mockResolvedValue(12168);
    const { countWaiting, overview } = controller(5);
    countWaiting.mockImplementation(async (_db, city) => (city ? 1 : 5));

    const answer = await overview.overview({ city: 'cluj-napoca' });

    expect(answer).toMatchObject({ cityGaragesWaiting: 1, garagesWaiting: 5 });
    expect(countWaiting).toHaveBeenCalledWith(prisma, 'cluj-napoca');
    expect(figures.mock.calls[0][2]).toEqual({
      city: 'cluj-napoca',
      period: 'default',
    });
    expect(Object.keys(answer)).not.toContain('activeDriversMonthStart');
    expect(monthStart).not.toHaveBeenCalled();
  });

  it('refuses a city with no listed garage as validation_failed', async () => {
    const { overview } = controller(0);

    await expect(
      overview.overview({ city: 'timisoara' }),
    ).rejects.toMatchObject({
      response: {
        code: 'validation_failed',
        errors: [{ code: 'unknown', field: 'city' }],
      },
      status: 400,
    });
    await expect(overview.growth({ city: 'timisoara' })).rejects.toMatchObject({
      status: 400,
    });
    expect(figures).not.toHaveBeenCalled();
    expect(growth).not.toHaveBeenCalled();
  });

  it('carries the active drivers of the first day of the period when its row exists', async () => {
    periodStart.mockResolvedValue(12000);
    const { overview } = controller(0);

    const answer = await overview.overview({ period: '7d' });

    expect(answer.activeDriversPeriodStart).toBe(12000);
    expect(periodStart).toHaveBeenCalledWith(prisma, expect.any(String));
    expect(figures.mock.calls[0][2]).toEqual({ city: 'all', period: '7d' });
  });

  it('reads no period start for today, the default or a city', async () => {
    periodStart.mockResolvedValue(12000);
    const { overview } = controller(0);

    for (const query of [
      { period: 'today' as const },
      {},
      { city: 'cluj-napoca', period: '7d' as const },
    ]) {
      const answer = await overview.overview(query);
      expect(Object.keys(answer)).not.toContain('activeDriversPeriodStart');
    }
    expect(periodStart).not.toHaveBeenCalled();
  });

  it('counts again at every call', async () => {
    const { countWaiting, overview } = controller(0);

    await overview.overview({});
    await overview.overview({});

    expect(countWaiting).toHaveBeenCalledTimes(2);
    expect(figures).toHaveBeenCalledTimes(2);
  });

  it('carries the overview dashboard link when Grafana is configured', async () => {
    const url = 'https://stack.grafana.net/d/motorfix-overview?var-env=test';
    const { overview } = controller(1, url);

    await expect(overview.overview({})).resolves.toMatchObject({
      observabilityUrl: url,
    });
  });

  it('carries no dashboard link when Grafana is not configured', async () => {
    const { overview } = controller(1);

    expect(Object.keys(await overview.overview({}))).not.toContain(
      'observabilityUrl',
    );
  });

  it('is open only to a session that may review garages', () => {
    const required = Reflect.getMetadata(
      'auth:requires',
      AdminOverviewController.prototype.overview,
    );

    expect(required).toBe('admin.garages');
  });
});

describe('the admin growth route', () => {
  it('answers the months read on the database at the moment of the call', async () => {
    const months = [
      { activeDrivers: 9870, garagesListed: 150, month: '2026-03' },
      { month: '2026-04' },
    ];
    growth.mockResolvedValue({ months });
    const { overview } = controller(0);
    const before = Date.now();

    await expect(overview.growth({})).resolves.toEqual({ months });

    const [db, at] = growth.mock.calls[0];
    expect(db).toBe(prisma);
    expect(at.getTime()).toBeGreaterThanOrEqual(before);
    expect(at.getTime()).toBeLessThanOrEqual(Date.now());
    expect(growth.mock.calls[0][2]).toBe('all');
  });

  it('reads the months of the chosen city', async () => {
    growth.mockResolvedValue({ months: [] });
    const { overview } = controller(0);

    await overview.growth({ city: 'cluj-napoca' });

    expect(growth.mock.calls[0][2]).toBe('cluj-napoca');
  });

  it('is open only to a session that may review garages', () => {
    const required = Reflect.getMetadata(
      'auth:requires',
      AdminOverviewController.prototype.growth,
    );

    expect(required).toBe('admin.garages');
  });
});

describe('the observability link', () => {
  it('opens the overview dashboard with the environment preselected', () => {
    expect(observabilityUrl('https://stack.grafana.net/', 'staging')).toBe(
      'https://stack.grafana.net/d/motorfix-overview?var-env=staging',
    );
  });

  it.each([
    [
      'https://example.org/grafana',
      'https://example.org/grafana/d/motorfix-overview?var-env=staging',
    ],
    [
      'https://example.org/grafana/',
      'https://example.org/grafana/d/motorfix-overview?var-env=staging',
    ],
    [
      'https://stack.grafana.net',
      'https://stack.grafana.net/d/motorfix-overview?var-env=staging',
    ],
  ])('keeps the path of a Grafana served at %s', (grafana, url) => {
    expect(observabilityUrl(grafana, 'staging')).toBe(url);
  });

  it('is absent when Grafana is not configured', () => {
    expect(observabilityUrl(undefined, 'production')).toBeUndefined();
  });
});

// @traces 066-FR-001 066-FR-002
describe('the garages reads', () => {
  it('answers the listed and suspended counts with the one waiting count, platform-wide', async () => {
    jest.mocked(countGarages).mockResolvedValue({ listed: 214, suspended: 2 });
    const { countWaiting, overview } = controller(3);

    await expect(overview.garagesSummary()).resolves.toEqual({
      listed: 214,
      suspended: 2,
      waiting: 3,
    });
    expect(countWaiting).toHaveBeenCalledWith(prisma);
  });

  it('reads the first 20 suspended garages by default, and the page asked for', async () => {
    const page = { items: [], total: 0 };
    jest.mocked(suspendedGarages).mockResolvedValue(page);
    const { overview } = controller(0);

    await expect(overview.garages({ status: 'suspended' })).resolves.toBe(page);
    await overview.garages({ limit: 40, offset: 200, status: 'suspended' });

    expect(jest.mocked(suspendedGarages).mock.calls).toEqual([
      [prisma, { limit: 20, offset: 0 }],
      [prisma, { limit: 40, offset: 200 }],
    ]);
  });
});
