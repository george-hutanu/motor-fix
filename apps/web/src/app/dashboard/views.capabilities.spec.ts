import { CAPABILITIES } from '@motor-fix/contracts/capabilities';

import { DASHBOARDS } from './views';

// @traces 102-FR-001
describe('the dashboard views and the capabilities table', () => {
  const every = Object.values(DASHBOARDS).flatMap(({ views, actions }) => [
    ...views,
    ...(actions ?? []),
  ]);

  it.each(
    every
      .filter((view) => view.capability)
      .map((view) => [view.label, view.capability as string]),
  )('names a capability of the table for %s (%s)', (_, capability) => {
    expect(CAPABILITIES as readonly string[]).toContain(capability);
  });

  it('checks at least one view of every area', () => {
    for (const area of ['driver', 'garage', 'admin'] as const)
      expect(DASHBOARDS[area].views.some((view) => view.capability)).toBe(true);
  });
});
