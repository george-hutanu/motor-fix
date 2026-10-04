import type { Routes } from '@angular/router';

import { languageAddress, languageRoot, toLanguageAddress } from './addresses';
import { areaGuard } from './dashboard/area.guard';
import { Home } from './home/home';
import { NotFound } from './not-found/not-found';
import { PublicFrame } from './public/frame';
import { Placeholder } from './public/placeholder';
import { toAccount } from './public/tab-bar';

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
  { canMatch: [areaGuard('driver')], loadComponent: frame, path: 'app/driver' },
  { canMatch: [areaGuard('garage')], loadComponent: frame, path: 'app/garage' },
  { canMatch: [areaGuard('admin')], loadComponent: frame, path: 'app/admin' },
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
        ...placeholder('account', 'public.placeholder.account'),
        canActivate: [toAccount],
      },
    ],
    component: PublicFrame,
    path: ':lang',
  },
  { component: NotFound, path: '**' },
];
