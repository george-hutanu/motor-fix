import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  conversion,
  figureWeeks,
  weeklyFigures,
} from './garage-figures.service';
import { atLocal, isoWeek } from '../../bucharest';

// An instant read on the Bucharest clock, "2026-10-04T23:50".
const at = (wall: string) => {
  const [on, time] = wall.split('T');
  const [hour, minute] = time.split(':').map(Number);
  return new Date(atLocal(on, hour).getTime() + minute * 60_000);
};

// One day's views as the views read buckets it, by ISO week.
const day = (on: string, views: number) => ({ key: isoWeek(on), views });

const approvedLongAgo = new Date('2025-01-15T10:00:00Z');

// @traces 144-FR-001
// @traces 144-FR-002
describe('the eight weeks answered', () => {
  it('are the complete ISO weeks before the current one, oldest first', () => {
    const weeks = figureWeeks('2026-10-08');

    expect(weeks).toHaveLength(8);
    expect(weeks.map((w) => w.key)).toEqual([
      '2026-W33',
      '2026-W34',
      '2026-W35',
      '2026-W36',
      '2026-W37',
      '2026-W38',
      '2026-W39',
      '2026-W40',
    ]);
    expect(weeks[7]).toEqual({
      from: '2026-09-28',
      key: '2026-W40',
      to: '2026-10-04',
    });
    expect(weeks[0]).toEqual({
      from: '2026-08-10',
      key: '2026-W33',
      to: '2026-08-16',
    });
  });

  it('end with last week on a Monday and never hold the running week', () => {
    expect(figureWeeks('2026-10-05').at(-1)?.key).toBe('2026-W40');
    expect(figureWeeks('2026-10-04').at(-1)?.key).toBe('2026-W39');
    expect(figureWeeks('2026-10-11').at(-1)?.key).toBe('2026-W40');
  });

  it('name a week by the year of its Thursday', () => {
    const weeks = figureWeeks('2027-01-06');

    expect(weeks.at(-1)).toEqual({
      from: '2026-12-28',
      key: '2026-W53',
      to: '2027-01-03',
    });
  });
});

// @traces 144-FR-004
describe('the conversion', () => {
  it('is requests over views in percent, one decimal, half up', () => {
    expect(conversion(29, 472)).toBe(6.1);
    expect(conversion(1, 16)).toBe(6.3);
    expect(conversion(1, 3)).toBe(33.3);
    expect(conversion(2, 3)).toBe(66.7);
    expect(conversion(0, 50)).toBe(0);
  });

  it('is null without views', () => {
    expect(conversion(4, 0)).toBeNull();
    expect(conversion(0, 0)).toBeNull();
  });

  it('never goes above 100', () => {
    expect(conversion(5, 3)).toBe(100);
    expect(conversion(7, 7)).toBe(100);
  });
});

// @traces 144-FR-003
describe('the weekly sums', () => {
  it('add the daily views of each week and count a missing day as nothing', () => {
    const weeks = weeklyFigures({
      approvedAt: approvedLongAgo,
      requests: [],
      today: '2026-10-08',
      views: [
        day('2026-09-28', 100),
        day('2026-10-01', 300),
        day('2026-10-04', 72),
        day('2026-09-27', 9),
        day('2026-10-05', 50),
      ],
    });

    expect(weeks[7]).toMatchObject({ key: '2026-W40', views: 472 });
    expect(weeks[6]).toMatchObject({ key: '2026-W39', views: 9 });
    expect(weeks[0]).toMatchObject({ conversion: null, requests: 0, views: 0 });
  });

  it('count a request in the Bucharest week it reached the garage', () => {
    const weeks = weeklyFigures({
      approvedAt: approvedLongAgo,
      requests: [
        ...Array.from({ length: 27 }, () => at('2026-10-01T12:00')),
        at('2026-10-04T23:50'),
        at('2026-10-05T00:05'),
        at('2026-09-28T00:00'),
        at('2026-09-27T23:59'),
      ],
      today: '2026-10-08',
      views: [day('2026-10-02', 472)],
    });

    expect(weeks[7]).toEqual({
      conversion: 6.1,
      from: '2026-09-28',
      key: '2026-W40',
      requests: 29,
      to: '2026-10-04',
      views: 472,
    });
    expect(weeks[6]).toMatchObject({ key: '2026-W39', requests: 1 });
  });

  it('keep a Sunday-night request in its week across both clock changes', () => {
    const march = weeklyFigures({
      approvedAt: approvedLongAgo,
      requests: [
        at('2026-03-23T00:00'),
        at('2026-03-29T23:50'),
        at('2026-03-30T00:05'),
        at('2026-03-22T23:59'),
      ],
      today: '2026-03-31',
      views: [],
    });
    expect(march.at(-1)).toMatchObject({
      from: '2026-03-23',
      key: '2026-W13',
      requests: 2,
      to: '2026-03-29',
    });
    expect(march.at(-2)).toMatchObject({ key: '2026-W12', requests: 1 });

    const october = weeklyFigures({
      approvedAt: approvedLongAgo,
      requests: [
        at('2026-10-19T00:00'),
        at('2026-10-25T23:50'),
        at('2026-10-26T00:05'),
        at('2026-10-18T23:59'),
      ],
      today: '2026-10-27',
      views: [],
    });
    expect(october.at(-1)).toMatchObject({
      from: '2026-10-19',
      key: '2026-W43',
      requests: 2,
      to: '2026-10-25',
    });
    expect(october.at(-2)).toMatchObject({ key: '2026-W42', requests: 1 });
  });
});

// @traces 144-FR-005
describe('the weeks before the approval', () => {
  it('are null, and the approval week counts whole', () => {
    const weeks = weeklyFigures({
      approvedAt: at('2026-09-16T11:00'),
      requests: [at('2026-09-14T09:00')],
      today: '2026-10-08',
      views: [day('2026-09-14', 5), day('2026-09-08', 3)],
    });

    for (const week of weeks.slice(0, 5))
      expect(week).toMatchObject({
        conversion: null,
        requests: null,
        views: null,
      });
    expect(weeks[5]).toMatchObject({
      conversion: 20,
      key: '2026-W38',
      requests: 1,
      views: 5,
    });
    expect(weeks[6]).toMatchObject({ requests: 0, views: 0 });
  });

  it('take the approval day on the Bucharest clock', () => {
    // Monday 00:30 in Bucharest is still Sunday in UTC.
    const weeks = weeklyFigures({
      approvedAt: at('2026-09-28T00:30'),
      requests: [],
      today: '2026-10-08',
      views: [],
    });

    expect(weeks[6]).toMatchObject({ key: '2026-W39', views: null });
    expect(weeks[7]).toMatchObject({ key: '2026-W40', views: 0 });
  });

  it('are all eight for a garage never approved', () => {
    const weeks = weeklyFigures({
      approvedAt: null,
      requests: [at('2026-10-01T10:00')],
      today: '2026-10-08',
      views: [day('2026-10-01', 4)],
    });

    expect(weeks).toHaveLength(8);
    for (const week of weeks)
      expect(week).toMatchObject({
        conversion: null,
        requests: null,
        views: null,
      });
  });
});

const doc = JSON.parse(
  readFileSync(join(__dirname, '../../../../../apps/api/openapi.json'), 'utf8'),
);

// @traces 144-FR-007
describe('the weekly figures in the OpenAPI document', () => {
  const get = doc.paths['/api/v1/garages/{garageId}/figures/weekly']?.get;

  it('is one read with its refusals', () => {
    expect(get.operationId).toBe('garageWeeklyFigures');
    expect(Object.keys(get.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
    ]);
    expect(
      get.responses['200'].content['application/json'].schema.$ref,
    ).toMatch(/WeeklyFiguresDto$/);
  });

  it('takes no query', () => {
    const names = get.parameters.map((p: { in: string }) => p.in);

    expect(names).toEqual(['path']);
  });
});

const inventory = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../../infra/observability/inventory.json'),
    'utf8',
  ),
);

// @traces 144-FR-008
describe('the weekly figures in the observability inventory', () => {
  it('is an endpoint watched by the route metric, its panel and alerts', () => {
    const entry = inventory.entries.find(
      (e: { name: string }) => e.name === 'garage-figures-weekly',
    );

    expect(entry).toMatchObject({
      alerts: ['api-error-rate', 'api-latency'],
      dashboard: 'motorfix-api',
      kind: 'endpoint',
      metric:
        'http.server.request.duration by http.route /api/v1/garages/:garageId/figures/weekly',
      source:
        'libs/domain/src/insights/garage-figures/garage-figures.controller.ts',
    });
  });
});
