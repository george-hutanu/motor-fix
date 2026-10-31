import { inject } from '@angular/core';
import type { Routes } from '@angular/router';
import { I18n } from '@motor-fix/i18n';

import {
  assistantTexts,
  cockpitTexts,
  languageAddress,
  publicTexts,
  toLanguageAddress,
} from './addresses';
import { areaGuard } from './dashboard/area.guard';
import { Home } from './home/home';
import { NotFound } from './not-found/not-found';

const frame = () => import('./dashboard/frame/frame').then((m) => m.Frame);
// On demand, like every other page: the site bar keeps it out of the first
// download's budget.
const publicFrame = () =>
  import('./public/frame/frame').then((m) => m.PublicFrame);

// canMatch, not canActivate: a refused area is never downloaded.
export const routes: Routes = [
  // In the public frame, like /ro, so the server's page has its landmarks too.
  // `toLanguageAddress` first: its redirect wins without waiting for the texts.
  {
    canMatch: [toLanguageAddress, publicTexts],
    children: [{ component: Home, path: '' }],
    data: { tabBar: false },
    loadComponent: publicFrame,
    path: '',
    pathMatch: 'full',
  },
  // The admins' way in, kept open during maintenance; no language prefix.
  {
    canMatch: [publicTexts],
    children: [
      {
        loadComponent: () =>
          import('./admin-sign-in/admin-sign-in').then((m) => m.AdminSignIn),
        path: '',
      },
    ],
    data: { tabBar: false },
    loadComponent: publicFrame,
    path: 'admin',
  },
  ...(['driver', 'garage', 'admin'] as const).map((area) => ({
    canMatch: [areaGuard(area)],
    // The views on demand too: every dashboard screen out of the first download.
    loadChildren: () =>
      import('./dashboard/views').then((m) => m.dashboardRoutes(area)),
    loadComponent: frame,
    path: `app/${area}`,
  })),
  // Outside the area frames: any role connects an assistant.
  {
    canMatch: [assistantTexts],
    loadComponent: () =>
      import('./assistant/connect/connect').then((m) => m.Connect),
    path: 'app/assistant/connect',
    title: () => inject(I18n).t('assistant.connecting'),
  },
  {
    canMatch: [assistantTexts],
    loadComponent: () =>
      import('./assistant/approval-page/approval-page').then(
        (m) => m.ApprovalPage,
      ),
    path: 'app/assistant/approvals/:id',
    title: () => inject(I18n).t('assistant.approval.page'),
  },
  {
    canMatch: [cockpitTexts],
    loadComponent: () =>
      import('@motor-fix/ui-cockpit/sample').then((m) => m.CockpitSamplePage),
    path: 'cockpit',
  },
  // Public pages: one address per language, the same path after the prefix.
  {
    canMatch: [languageAddress],
    // On demand with the frame: the pages' entries stay out of the first
    // download, whose budget the production build enforces.
    loadChildren: () => import('./public/routes').then((m) => m.publicChildren),
    loadComponent: publicFrame,
    path: ':lang',
  },
  { component: NotFound, path: '**' },
];
