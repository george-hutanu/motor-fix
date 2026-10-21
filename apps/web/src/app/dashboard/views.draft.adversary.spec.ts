import { allowedViews, DASHBOARDS } from './views';

const ALL_CAPS = [
  'garage.requests',
  'garage.schedule',
  'garage.team',
  'garage.prices',
  'garage.reviews',
  'garage.profile',
  'garage.audit_history',
  'garage.final_price',
  'garage.own_jobs',
  'garage.feature_switches',
  'driver.cars',
  'admin.garages',
];

describe('the views of a draft garage', () => {
  // @traces 101-FR-007
  it('opens no garage view for any capabilities and features', () => {
    expect(allowedViews('garage', ALL_CAPS, {}, 'draft')).toEqual([]);
    expect(allowedViews('garage', [], {}, 'draft')).toEqual([]);
    expect(
      allowedViews('garage', ALL_CAPS, { anything: true }, 'draft'),
    ).toEqual([]);
  });

  // @traces 101-FR-007
  it.each(['driver', 'admin'] as const)(
    'leaves the %s area its views whatever the status says',
    (area) => {
      const without = allowedViews(area, ALL_CAPS);

      expect(allowedViews(area, ALL_CAPS, {}, 'draft')).toEqual(without);
      expect(without.length).toBeGreaterThan(0);
    },
  );

  // @traces 101-FR-007
  it.each(['approved', 'suspended', undefined] as const)(
    'gives the garage area its views for status %s',
    (status) => {
      const views = allowedViews('garage', ALL_CAPS, {}, status);

      expect(views).toEqual(allowedViews('garage', ALL_CAPS));
      expect(views.length).toBeGreaterThan(0);
    },
  );

  // @traces 101-FR-007
  it('gives the views back for the same inputs once the status moves from draft to approved', () => {
    expect(allowedViews('garage', ALL_CAPS, {}, 'draft')).toEqual([]);
    expect(
      allowedViews('garage', ALL_CAPS, {}, 'approved').map((v) => v.path),
    ).toEqual(allowedViews('garage', ALL_CAPS).map((v) => v.path));
    expect(allowedViews('garage', ALL_CAPS, {}, 'draft')).toEqual([]);
  });

  // @traces 101-FR-007
  it('leaves the definition of the garage views untouched by a draft read', () => {
    const before = DASHBOARDS.garage.views.length;

    allowedViews('garage', ALL_CAPS, {}, 'draft');

    expect(DASHBOARDS.garage.views).toHaveLength(before);
  });

  // @traces 101-FR-007
  it('treats a status it does not know as not draft', () => {
    const views = allowedViews(
      'garage',
      ALL_CAPS,
      {},
      'DRAFT' as unknown as 'draft',
    );

    expect(views).toEqual(allowedViews('garage', ALL_CAPS));
  });
});
