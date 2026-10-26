// @traces 091-FR-001 091-FR-004

import { monthlyAverageKm, serviceDueOn } from './odometer';
import { localDay } from '../../bucharest';

const TODAY = '2026-10-08';

describe('the estimate against awkward readings', () => {
  it('takes the later-created of two readings on the same day as the newest', () => {
    const readings = [
      {
        createdAt: new Date('2025-10-08T08:00:00Z'),
        km: 131_900,
        readOn: '2025-10-08',
      },
      {
        createdAt: new Date('2026-10-08T12:00:00Z'),
        km: 148_200,
        readOn: TODAY,
      },
      {
        createdAt: new Date('2026-10-08T07:00:00Z'),
        km: 140_000,
        readOn: TODAY,
      },
    ];
    expect(Math.round(monthlyAverageKm(readings, TODAY))).toBe(1359);
  });

  it('takes the earlier-created of two readings on the oldest day as the oldest', () => {
    const readings = [
      {
        createdAt: new Date('2025-10-08T12:00:00Z'),
        km: 140_000,
        readOn: '2025-10-08',
      },
      {
        createdAt: new Date('2025-10-08T07:00:00Z'),
        km: 131_900,
        readOn: '2025-10-08',
      },
      {
        createdAt: new Date('2026-10-08T07:00:00Z'),
        km: 148_200,
        readOn: TODAY,
      },
    ];
    expect(Math.round(monthlyAverageKm(readings, TODAY))).toBe(1359);
  });

  it('counts a reception or repair reading like the driver one', () => {
    const readings = [
      {
        createdAt: new Date('2025-10-08T08:00:00Z'),
        km: 131_900,
        readOn: '2025-10-08',
        source: 'reception',
      },
      {
        createdAt: new Date('2026-10-08T08:00:00Z'),
        km: 148_200,
        readOn: TODAY,
        source: 'repair',
      },
    ];
    expect(Math.round(monthlyAverageKm(readings, TODAY))).toBe(1359);
  });

  it('reads today as the Bucharest day late in the UTC evening', () => {
    const today = localDay(new Date('2026-10-07T21:30:00Z'));
    const readings = [{ createdAt: new Date(), km: 148_200, readOn: today }];
    expect(
      serviceDueOn(
        { nextServiceKm: 152_000, odometerKm: 148_200 },
        readings,
        today,
      ),
    ).toBe('2027-02-01');
  });

  it('gives a real day for the largest kilometres', () => {
    const readings = [{ createdAt: new Date(), km: 1_899_000, readOn: TODAY }];
    expect(
      serviceDueOn(
        { nextServiceKm: 1_999_000, odometerKm: 1_899_000 },
        readings,
        TODAY,
      ),
    ).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
