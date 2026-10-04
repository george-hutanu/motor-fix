import type { Routes } from '@angular/router';

import { languageAddress, languageRoot, toLanguageAddress } from './addresses';
import { areaGuard } from './dashboard/area.guard';
import { dashboardRoutes } from './dashboard/views';
import { Home } from './home/home';
import { NotFound } from './not-found/not-found';
import { signedInToDashboard } from './public/account.guard';
import { PublicFrame } from './public/frame';
import { Placeholder } from './public/placeholder';

const frame = () => import('./dashboard/frame').then((m) => m.Frame);

const placeholder = (path: string, title: string) => ({
  component: Placeholder,
  data: { title },
  path,
});

// canMatch, not canActivate: a refused area is never downloaded.
export const routes: Routes = [
  {
    canMatch: [toLanguageAddress],
    component: Home,
    path: '',
    pathMatch: 'full',
  },
  ...(['driver', 'garage', 'admin'] as const).map((area) => ({
    canMatch: [areaGuard(area)],
    children: dashboardRoutes(area),
    loadComponent: frame,
    path: `app/${area}`,
  })),
  {
    loadComponent: () =>
      import('@motor-fix/ui-cockpit/sample').then((m) => m.CockpitSamplePage),
    path: 'cockpit',
  },
  // Public pages: one address per language, the same path after the prefix.
  {
    canMatch: [languageAddress],
    children: [
      { component: Home, matcher: languageRoot },
      placeholder('garages', 'public.placeholder.garages'),
      placeholder('garages/:garage', 'public.placeholder.garages'),
      placeholder('mechanics/:mechanic', 'public.placeholder.mechanics'),
      {
        loadComponent: () =>
          import('./public/confirm-email').then((m) => m.ConfirmEmail),
        path: 'confirm-email/:token',
      },
      {
        ...placeholder('account', 'public.placeholder.account'),
        canActivate: [signedInToDashboard],
      },
    ],
    component: PublicFrame,
    path: ':lang',
  },
  { component: NotFound, path: '**' },
];
