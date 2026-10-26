import type { Capability } from '@motor-fix/contracts/capabilities';
import type { MeDto } from '@motor-fix/data-access';

import { garageOf } from './session';
import { allowedViews } from './views';

export type SectionKey =
  | 'kpi'
  | 'now'
  | 'req'
  | 'load'
  | 'sched'
  | 'funnel'
  | 'brands'
  | 'reviews';

export interface GarageSection {
  readonly key: SectionKey;
  readonly title: string;
  // The garage view the title opens.
  readonly view: string;
  readonly capability: Capability;
  // The switch that removes the section while it is off.
  readonly feature?: string;
  readonly unreleased?: true;
  // The one sentence a section not built yet shows.
  readonly empty?: string;
}

const planned = (
  key: SectionKey,
  view: string,
  capability: Capability,
  extra: Partial<GarageSection> = {},
): GarageSection => ({
  capability,
  empty: `garage.home.empty.${key}`,
  key,
  title: `garage.home.section.${key}`,
  view,
  ...extra,
});

// Panou's sections in their default order.
export const GARAGE_SECTIONS: readonly GarageSection[] = [
  planned('kpi', 'profile', 'garage.profile'),
  planned('now', 'schedule', 'garage.profile', { unreleased: true }),
  {
    capability: 'garage.requests',
    key: 'req',
    title: 'garage.requests.heading',
    view: 'requests',
  },
  planned('load', 'team', 'garage.own_jobs', { feature: 'team_mechanics' }),
  planned('sched', 'schedule', 'garage.schedule', { feature: 'lift_schedule' }),
  planned('funnel', 'profile', 'garage.profile'),
  planned('brands', 'profile', 'garage.profile'),
  {
    capability: 'garage.reviews',
    key: 'reviews',
    title: 'garage.reviews.title',
    view: 'reviews',
  },
];

// The sections this person sees, in order: none for a garage still in draft.
export const homeSections = (me: MeDto | null): GarageSection[] => {
  const garage = garageOf(me);
  if (!garage || garage.status === 'draft') return [];
  const capabilities: readonly string[] = me?.capabilities ?? [];
  const features: Readonly<Record<string, boolean>> = garage.features ?? {};
  return GARAGE_SECTIONS.filter(
    (section) =>
      !section.unreleased &&
      capabilities.includes(section.capability) &&
      !(section.feature && features[section.feature] === false),
  );
};

// Whether this person's menu holds the garage view a title opens.
export const linksTo = (me: MeDto | null, view: string): boolean => {
  const garage = garageOf(me);
  if (!me || !garage) return false;
  return allowedViews(
    'garage',
    me.capabilities,
    garage.features ?? {},
    garage.status,
  ).some((allowed) => allowed.path === view);
};
