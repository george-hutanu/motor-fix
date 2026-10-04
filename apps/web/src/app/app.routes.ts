import type { Routes } from '@angular/router';

import { areaGuard } from './dashboard/area.guard';
import { Home } from './home/home';

const frame = () => import('./dashboard/frame').then((m) => m.Frame);

// canMatch, not canActivate: a refused area is never downloaded.
export const routes: Routes = [
  { component: Home, path: '' },
  { canMatch: [areaGuard('driver')], loadComponent: frame, path: 'app/driver' },
  { canMatch: [areaGuard('garage')], loadComponent: frame, path: 'app/garage' },
  { canMatch: [areaGuard('admin')], loadComponent: frame, path: 'app/admin' },
  {
    loadComponent: () =>
      import('@motor-fix/ui-cockpit/sample').then((m) => m.CockpitSamplePage),
    path: 'cockpit',
  },
  { path: '**', redirectTo: '' },
];
