import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    loadComponent: () =>
      import('@motor-fix/ui-cockpit/sample').then((m) => m.CockpitSamplePage),
    path: 'cockpit',
  },
];
