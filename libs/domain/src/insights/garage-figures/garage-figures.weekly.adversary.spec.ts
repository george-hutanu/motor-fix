import {
  conversion,
  figureWeeks,
  weeklyFigures,
} from './garage-figures.service';
import { isoWeek } from '../../bucharest';

const approvedLongAgo = new Date('2020-01-01T10:00:00Z');

// @traces 144-FR-001
// @traces 144-FR-002
describe('the eight weeks across year boundaries', () => {
  it('name a 53-week year W53 and the next January W01', () => {
    const weeks = figureWeeks('2027-01-04');
    expect(weeks.at(-1)).toEqual({
      from: '2026-12-28',
      key: '2026-W53',
      to: '2027-01-03',
    });
    expect(weeks.at(-2)?.key).toBe('2026-W52');
  });

  it('key a week starting in December by the next year when its Thursday is in January', () => {
    expect(figureWeeks('2025-01-06').at(-1)).toEqual({
      from: '2024-12-30',
      key: '2025-W01',
      to: '2025-01-05',
    });
  });

  it('cross a leap day with contiguous seven-day weeks', () => {
    const weeks = figureWeeks('2024-03-12');
    expect(weeks).toHaveLength(8);
    expect(weeks.map((w) => w.from)).toEqual([
      '2024-01-15',
      '2024-01-22',
      '2024-01-29',
      '2024-02-05',
      '2024-02-12',
      '2024-02-19',
      '2024-02-26',
      '2024-03-04',
    ]);
    expect(weeks[7].to).toBe('2024-03-10');
  });

  it('give the same weeks for every day of one week', () => {
    const monday = figureWeeks('2026-10-05');
    for (const d of ['06', '07', '08', '09', '10', '11']) {
      expect(figureWeeks(`2026-10-${d}`)).toEqual(monday);
    }
  });
});

// @traces 144-FR-004
describe('the conversion at its edges', () => {
  it('is 0 for no requests with views', () => {
    expect(conversion(0, 5)).toBe(0);
  });

  it('rounds exact halves up to the tenth', () => {
    expect(conversion(1, 8)).toBe(12.5);
    expect(conversion(1, 16)).toBe(6.3);
    expect(conversion(1, 3)).toBe(33.3);
    expect(conversion(2, 3)).toBe(66.7);
  });

  it('rounds 0.05 percent up to 0.1', () => {
    expect(conversion(1, 2000)).toBe(0.1);
    expect(conversion(1, 2001)).toBe(0);
  });

  it('caps requests above views at 100', () => {
    expect(conversion(1_000_000, 1)).toBe(100);
    expect(conversion(5, 5)).toBe(100);
  });

  it('stays exact for huge counts', () => {
    expect(conversion(29, 472)).toBe(6.1);
    expect(conversion(123_456, 9_999_999)).toBe(1.2);
  });
});

// @traces 144-FR-003
describe('the weekly sums on odd input', () => {
  it('answer eight zero weeks for an approved garage with nothing recorded', () => {
    const weeks = weeklyFigures({
      approvedAt: approvedLongAgo,
      requests: [],
      today: '2026-10-08',
      views: [],
    });
    expect(weeks).toHaveLength(8);
    for (const w of weeks)
      expect(w).toMatchObject({ conversion: null, requests: 0, views: 0 });
  });

  it('ignore views and requests outside the eight weeks', () => {
    const weeks = weeklyFigures({
      approvedAt: approvedLongAgo,
      requests: [
        new Date('2026-08-09T20:00:00Z'),
        new Date('2026-10-04T21:00:00Z'),
      ],
      today: '2026-10-08',
      views: [
        { key: isoWeek('2026-08-09'), views: 50 },
        { key: isoWeek('2026-10-05'), views: 70 },
      ],
    });
    expect(weeks.map((w) => w.views)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(weeks.map((w) => w.requests)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('sum every bucket of one week, in any order', () => {
    const weeks = weeklyFigures({
      approvedAt: approvedLongAgo,
      requests: [],
      today: '2026-10-08',
      views: [
        { key: isoWeek('2026-10-04'), views: 3 },
        { key: isoWeek('2026-09-28'), views: 4 },
        { key: isoWeek('2026-09-28'), views: 5 },
      ],
    });
    expect(weeks[7].views).toBe(12);
  });

  it('count ten thousand requests in one week', () => {
    const at = new Date('2026-09-30T09:00:00Z');
    const weeks = weeklyFigures({
      approvedAt: approvedLongAgo,
      requests: Array.from({ length: 10_000 }, () => at),
      today: '2026-10-08',
      views: [{ key: isoWeek('2026-09-30'), views: 20_000 }],
    });
    expect(weeks[7]).toMatchObject({
      conversion: 50,
      requests: 10_000,
      views: 20_000,
    });
  });
});

// @traces 144-FR-005
describe('the approval boundary', () => {
  it('answers eight nulls when approval is after today', () => {
    const weeks = weeklyFigures({
      approvedAt: new Date('2027-01-01T10:00:00Z'),
      requests: [new Date('2026-10-01T09:00:00Z')],
      today: '2026-10-08',
      views: [{ key: isoWeek('2026-10-01'), views: 9 }],
    });
    for (const w of weeks)
      expect(w).toMatchObject({
        conversion: null,
        requests: null,
        views: null,
      });
  });

  it('puts approval on Sunday 23:50 Bucharest in that week and the one after', () => {
    const weeks = weeklyFigures({
      approvedAt: new Date('2026-10-04T20:50:00Z'),
      requests: [],
      today: '2026-10-12',
      views: [],
    });
    expect(weeks.at(-1)?.key).toBe('2026-W41');
    expect(weeks.at(-1)?.views).toBe(0);
    expect(weeks.at(-2)?.key).toBe('2026-W40');
    expect(weeks.at(-2)?.views).toBe(0);
    expect(weeks.at(-3)?.views).toBeNull();
  });

  it('puts approval at Monday 00:30 Bucharest in the new week only', () => {
    const weeks = weeklyFigures({
      approvedAt: new Date('2026-10-04T21:30:00Z'),
      requests: [],
      today: '2026-10-12',
      views: [],
    });
    expect(weeks.at(-1)?.views).toBe(0);
    expect(weeks.at(-2)?.views).toBeNull();
  });

  it('counts a request before approval in the approval week', () => {
    const weeks = weeklyFigures({
      approvedAt: new Date('2026-10-02T10:00:00Z'),
      requests: [new Date('2026-09-29T09:00:00Z')],
      today: '2026-10-08',
      views: [{ key: isoWeek('2026-09-29'), views: 10 }],
    });
    expect(weeks[7]).toMatchObject({ conversion: 10, requests: 1, views: 10 });
    expect(weeks[6].requests).toBeNull();
  });
});
