// @traces 879-FR-018 879-FR-020
import {
  AdminOverviewController,
  observabilityUrl,
} from './admin-overview.controller';
import type { VerificationService } from './verification/verification.service';
import type { PrismaClient } from '../generated/prisma/client';
import {
  countPlatformFigures,
  monthStartSnapshot,
  readGrowth,
} from '../insights/platform-figures';

jest.mock('../insights/platform-figures', () => ({
  countPlatformFigures: jest.fn(),
  monthStartSnapshot: jest.fn(),
  readGrowth: jest.fn(),
}));

const prisma = {} as PrismaClient;
const figures = jest.mocked(countPlatformFigures);
const monthStart = jest.mocked(monthStartSnapshot);
const growth = jest.mocked(readGrowth);

const controller = (waiting: number, observabilityUrl?: string) => {
  const countWaiting = jest.fn(async () => waiting);
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
    garagesApprovedThisMonth: 9,
    garagesListed: 214,
  });
  monthStart.mockResolvedValue(undefined);
});

describe('the admin overview route', () => {
  it('answers the number of garages waiting, counted on the database', async () => {
    const { countWaiting, overview } = controller(4);

    await expect(overview.overview()).resolves.toMatchObject({
      garagesWaiting: 4,
    });
    expect(countWaiting).toHaveBeenCalledWith(prisma);
  });

  it('answers the platform figures beside the garages waiting, with no month-start value when there is no row', async () => {
    const { overview } = controller(2);

    const answer = await overview.overview();

    expect(answer).toEqual({
      activeDrivers: 12480,
      garagesApprovedThisMonth: 9,
      garagesListed: 214,
      garagesWaiting: 2,
    });
    expect(Object.keys(answer)).not.toContain('activeDriversMonthStart');
  });

  it('carries the active drivers of the first of the month when its row exists', async () => {
    monthStart.mockResolvedValue(12168);
    const { overview } = controller(2);

    await expect(overview.overview()).resolves.toEqual({
      activeDrivers: 12480,
      activeDriversMonthStart: 12168,
      garagesApprovedThisMonth: 9,
      garagesListed: 214,
      garagesWaiting: 2,
    });
  });

  it('counts the figures on the database at the moment of the call', async () => {
    const { overview } = controller(0);
    const before = Date.now();

    await overview.overview();

    const [db, at] = figures.mock.calls[0];
    expect(db).toBe(prisma);
    expect(at.getTime()).toBeGreaterThanOrEqual(before);
    expect(at.getTime()).toBeLessThanOrEqual(Date.now());
    expect(monthStart).toHaveBeenCalledWith(prisma, at);
  });

  it('counts again at every call', async () => {
    const { countWaiting, overview } = controller(0);

    await overview.overview();
    await overview.overview();

    expect(countWaiting).toHaveBeenCalledTimes(2);
    expect(figures).toHaveBeenCalledTimes(2);
  });

  it('carries the overview dashboard link when Grafana is configured', async () => {
    const url = 'https://stack.grafana.net/d/motorfix-overview?var-env=test';
    const { overview } = controller(1, url);

    await expect(overview.overview()).resolves.toMatchObject({
      observabilityUrl: url,
    });
  });

  it('carries no dashboard link when Grafana is not configured', async () => {
    const { overview } = controller(1);

    expect(Object.keys(await overview.overview())).not.toContain(
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

    await expect(overview.growth()).resolves.toEqual({ months });

    const [db, at] = growth.mock.calls[0];
    expect(db).toBe(prisma);
    expect(at.getTime()).toBeGreaterThanOrEqual(before);
    expect(at.getTime()).toBeLessThanOrEqual(Date.now());
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

  it('is absent when Grafana is not configured', () => {
    expect(observabilityUrl(undefined, 'production')).toBeUndefined();
  });
});
