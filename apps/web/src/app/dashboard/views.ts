import { inject, type Type } from '@angular/core';
import type { Routes } from '@angular/router';

import { AdminPanel } from './admin-panel/admin-panel';
import { AdminUsers } from './admin-users/admin-users';
import { CarsView } from './cars-view/cars-view';
import { DriverHome } from './driver-home/driver-home';
import { DriverSettingsView } from './driver-settings-view/driver-settings-view';
import { PushView } from './push-view/push-view';
import { RequestsView } from './requests-view/requests-view';
import { garageOf, Session } from './session';
import { SettingsView } from './settings-view/settings-view';
import { View } from './view/view';

export type Area = 'driver' | 'garage' | 'admin';

// The numbers a dashboard's menu entries carry, while known.
export type Counts = Partial<Record<'garagesWaiting', number>>;

// `label` (the menu's) and `tab` (the bar's, shorter) are shell translation keys.
export interface DashboardView {
  path: string;
  // The view's body, once its story has built one.
  body?: Type<unknown>;
  label: string;
  tab: string;
  // The header's own title and the line under it; absent, the label is the title.
  title?: string;
  subtitle?: string;
  // Absent: every role of the area sees it.
  capability?: string;
  // The garage feature switch it needs; absent or on in the switches, shown.
  feature?: string;
  // What will appear here, until its story builds the body.
  empty?: string;
  // The view's body carries this device's push panel.
  push?: boolean;
  // ...and, under it, the person's staff notification choices.
  staff?: boolean;
  // Not built yet: out of the menu, the bar and the routes until its story
  // ships it.
  unreleased?: true;
  // The admin overview number its menu entry and tab carry.
  counter?: keyof Counts;
}

const HOME: DashboardView = {
  label: 'shell.frame.nav.dashboard',
  path: '',
  tab: 'shell.frame.tab.dashboard',
};

// A garage view whose keys all follow its path.
const garageView = (path: string, capability?: string): DashboardView => ({
  capability,
  empty: `shell.frame.coming.garage.${path}`,
  label: `shell.frame.nav.garage.${path}`,
  path,
  subtitle: `shell.frame.subtitle.garage.${path}`,
  tab: `shell.frame.tab.${path}`,
  title: `shell.frame.title.garage.${path}`,
});

// One list per dashboard: the side menu, the tab bar and the routes read it.
export const DASHBOARDS: Record<
  Area,
  { name: string; tag: string; views: readonly DashboardView[] }
> = {
  admin: {
    name: 'shell.frame.bar.admin',
    tag: 'shell.frame.area.admin',
    views: [
      // The admin bar says Dashboard in English, where the others say Home.
      { ...HOME, body: AdminPanel, tab: 'shell.frame.tab.overview' },
      {
        capability: 'admin.garages',
        counter: 'garagesWaiting',
        label: 'shell.frame.nav.admin.garages',
        path: 'garages',
        tab: 'shell.frame.tab.garages',
      },
      {
        body: AdminUsers,
        capability: 'admin.users',
        label: 'shell.frame.nav.admin.users',
        path: 'users',
        tab: 'shell.frame.tab.users',
      },
      {
        capability: 'admin.reviews',
        label: 'shell.frame.nav.admin.reviews',
        path: 'reviews',
        tab: 'shell.frame.tab.reported',
        unreleased: true,
      },
      {
        capability: 'admin.catalogue',
        label: 'shell.frame.nav.admin.catalogue',
        path: 'catalogue',
        tab: 'shell.frame.tab.brands',
        unreleased: true,
      },
      {
        capability: 'admin.settings',
        label: 'shell.frame.nav.admin.assistant',
        path: 'assistant',
        tab: 'shell.frame.tab.assistant',
        unreleased: true,
      },
      {
        capability: 'admin.settings',
        label: 'shell.frame.nav.admin.settings',
        path: 'settings',
        push: true,
        staff: true,
        tab: 'shell.frame.tab.settings',
      },
    ],
  },
  driver: {
    name: 'shell.frame.bar.driver',
    tag: 'shell.frame.area.driver',
    views: [
      {
        ...HOME,
        body: DriverHome,
        title: 'shell.frame.title.driver.dashboard',
      },
      {
        body: RequestsView,
        capability: 'driver.requests',
        label: 'shell.frame.nav.driver.requests',
        path: 'requests',
        tab: 'shell.frame.tab.requests',
        title: 'shell.frame.title.driver.requests',
      },
      {
        body: CarsView,
        capability: 'driver.cars',
        label: 'shell.frame.nav.driver.cars',
        path: 'cars',
        tab: 'shell.frame.tab.cars',
        title: 'shell.frame.title.driver.cars',
      },
      {
        capability: 'driver.reviews',
        label: 'shell.frame.nav.driver.reviews',
        path: 'reviews',
        tab: 'shell.frame.tab.reviews',
        title: 'shell.frame.title.driver.reviews',
      },
      {
        capability: 'driver.saved_garages',
        label: 'shell.frame.nav.driver.savedGarages',
        path: 'saved',
        tab: 'shell.frame.tab.saved',
        title: 'shell.frame.title.driver.saved',
      },
      {
        label: 'shell.frame.nav.driver.assistant',
        path: 'assistant',
        tab: 'shell.frame.tab.ai',
        title: 'shell.frame.title.driver.assistant',
        unreleased: true,
      },
      {
        body: DriverSettingsView,
        capability: 'driver.settings',
        label: 'shell.frame.nav.driver.settings',
        path: 'settings',
        push: true,
        subtitle: 'shell.frame.subtitle.driver.settings',
        tab: 'shell.frame.tab.settings',
        title: 'shell.frame.title.driver.settings',
      },
    ],
  },
  garage: {
    name: 'shell.frame.bar.garage',
    tag: 'shell.frame.area.garage',
    views: [
      {
        ...HOME,
        empty: 'shell.frame.coming.garage.dashboard',
        title: 'shell.frame.bar.garage',
      },
      garageView('requests', 'garage.requests'),
      garageView('schedule', 'garage.schedule'),
      { ...garageView('team', 'garage.team'), feature: 'team_mechanics' },
      garageView('prices', 'garage.prices'),
      garageView('reviews', 'garage.reviews'),
      garageView('profile', 'garage.profile'),
      {
        label: 'shell.frame.nav.garage.assistant',
        path: 'assistant',
        tab: 'shell.frame.tab.ai',
        title: 'shell.frame.title.garage.assistant',
        unreleased: true,
      },
      // No capability: every garage role, the mechanic included, has Setări.
      {
        label: 'shell.frame.nav.garage.settings',
        path: 'settings',
        push: true,
        staff: true,
        subtitle: 'shell.frame.subtitle.garage.settings',
        tab: 'shell.frame.tab.settings',
        title: 'shell.frame.title.garage.settings',
      },
      garageView('history', 'garage.audit_history'),
    ],
  },
};

export const allowedViews = (
  area: Area,
  capabilities: readonly string[],
  features: Readonly<Record<string, boolean>> = {},
): DashboardView[] =>
  DASHBOARDS[area].views.filter(
    (view) =>
      !view.unreleased &&
      (!view.capability || capabilities.includes(view.capability)) &&
      !(view.feature && features[view.feature] === false),
  );

// The area guard has loaded the session before these match. A view owns its
// sub-paths, so its epic can add pages under it; a refused or unknown view
// falls through to `**`, which sends it to the dashboard view.
const body = ({ body, push, staff }: DashboardView) =>
  body ?? (staff ? SettingsView : push ? PushView : View);

export const dashboardRoutes = (area: Area): Routes => [
  {
    component: body(DASHBOARDS[area].views[0]),
    data: { area, view: DASHBOARDS[area].views[0] },
    path: '',
    pathMatch: 'full',
  },
  ...DASHBOARDS[area].views
    .filter((view) => view.path && !view.unreleased)
    .map((view) => ({
      canMatch: [
        () => {
          const me = inject(Session).current();
          return allowedViews(
            area,
            me?.capabilities ?? [],
            garageOf(me)?.features,
          ).includes(view);
        },
      ],
      children: [{ component: body(view), data: { area, view }, path: '**' }],
      path: view.path,
    })),
  { path: '**', redirectTo: '' },
];
