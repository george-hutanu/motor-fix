import { inject } from '@angular/core';
import type { Routes } from '@angular/router';

import { Session } from './session';
import { View } from './view';

export type Area = 'driver' | 'garage' | 'admin';

// `label` (the menu's) and `tab` (the bar's, shorter) are shell translation keys.
export interface DashboardView {
  path: string;
  label: string;
  tab: string;
  // Absent: every role of the area sees it.
  capability?: string;
}

const HOME: DashboardView = {
  label: 'shell.frame.nav.dashboard',
  path: '',
  tab: 'shell.frame.tab.dashboard',
};

// One list per dashboard: the side menu, the tab bar and the routes read it.
export const DASHBOARDS: Record<
  Area,
  { name: string; tag: string; views: readonly DashboardView[] }
> = {
  admin: {
    name: 'shell.frame.tabs.admin',
    tag: 'shell.frame.area.admin',
    views: [
      HOME,
      {
        capability: 'admin.garages',
        label: 'shell.frame.nav.admin.garages',
        path: 'garages',
        tab: 'shell.frame.tab.garages',
      },
      {
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
      },
      {
        capability: 'admin.catalogue',
        label: 'shell.frame.nav.admin.catalogue',
        path: 'catalogue',
        tab: 'shell.frame.tab.brands',
      },
      {
        capability: 'admin.settings',
        label: 'shell.frame.nav.admin.settings',
        path: 'settings',
        tab: 'shell.frame.tab.settings',
      },
    ],
  },
  driver: {
    name: 'shell.frame.tabs.driver',
    tag: 'shell.frame.area.driver',
    views: [
      HOME,
      {
        capability: 'driver.requests',
        label: 'shell.frame.nav.driver.requests',
        path: 'requests',
        tab: 'shell.frame.tab.requests',
      },
      {
        capability: 'driver.cars',
        label: 'shell.frame.nav.driver.cars',
        path: 'cars',
        tab: 'shell.frame.tab.cars',
      },
      {
        capability: 'driver.reviews',
        label: 'shell.frame.nav.driver.reviews',
        path: 'reviews',
        tab: 'shell.frame.tab.reviews',
      },
      {
        capability: 'driver.saved_garages',
        label: 'shell.frame.nav.driver.savedGarages',
        path: 'saved',
        tab: 'shell.frame.tab.saved',
      },
      {
        capability: 'driver.settings',
        label: 'shell.frame.nav.driver.settings',
        path: 'settings',
        tab: 'shell.frame.tab.settings',
      },
    ],
  },
  garage: {
    name: 'shell.frame.tabs.garage',
    tag: 'shell.frame.area.garage',
    views: [
      HOME,
      {
        capability: 'garage.requests',
        label: 'shell.frame.nav.garage.requests',
        path: 'requests',
        tab: 'shell.frame.tab.requests',
      },
      {
        capability: 'garage.schedule',
        label: 'shell.frame.nav.garage.schedule',
        path: 'schedule',
        tab: 'shell.frame.tab.schedule',
      },
      {
        capability: 'garage.team',
        label: 'shell.frame.nav.garage.team',
        path: 'team',
        tab: 'shell.frame.tab.team',
      },
      {
        capability: 'garage.prices',
        label: 'shell.frame.nav.garage.prices',
        path: 'prices',
        tab: 'shell.frame.tab.prices',
      },
      {
        capability: 'garage.reviews',
        label: 'shell.frame.nav.garage.reviews',
        path: 'reviews',
        tab: 'shell.frame.tab.reviews',
      },
      {
        capability: 'garage.profile',
        label: 'shell.frame.nav.garage.profile',
        path: 'profile',
        tab: 'shell.frame.tab.profile',
      },
    ],
  },
};

export const allowedViews = (
  area: Area,
  capabilities: readonly string[],
): DashboardView[] =>
  DASHBOARDS[area].views.filter(
    (view) => !view.capability || capabilities.includes(view.capability),
  );

// The area guard has loaded the session before these match. A refused or
// unknown view falls through to `**`, which sends it to the dashboard view.
export const dashboardRoutes = (area: Area): Routes => [
  { component: View, path: '', pathMatch: 'full' },
  ...DASHBOARDS[area].views
    .filter((view) => view.path)
    .map((view) => ({
      canMatch: [
        () =>
          allowedViews(
            area,
            inject(Session).current()?.capabilities ?? [],
          ).includes(view),
      ],
      component: View,
      path: view.path,
    })),
  { path: '**', redirectTo: '' },
];
