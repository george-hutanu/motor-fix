import { inject } from '@angular/core';
import type { Routes } from '@angular/router';
import { I18n } from '@motor-fix/i18n';

import {
  assistantTexts,
  cockpitTexts,
  languageAddress,
  languageRoot,
  publicTexts,
  toLanguageAddress,
} from './addresses';
import { areaGuard } from './dashboard/area.guard';
import { Home } from './home/home';
import { NotFound } from './not-found/not-found';
import { signedInToDashboard } from './public/account.guard';
import { Placeholder } from './public/placeholder/placeholder';

const frame = () => import('./dashboard/frame/frame').then((m) => m.Frame);
// On demand, like every other page: the site bar keeps it out of the first
// download's budget.
const publicFrame = () =>
  import('./public/frame/frame').then((m) => m.PublicFrame);

const placeholder = (path: string, title: string) => ({
  component: Placeholder,
  data: { title },
  path,
});

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
    canMatch: [cockpitTexts],
    loadComponent: () =>
      import('@motor-fix/ui-cockpit/sample').then((m) => m.CockpitSamplePage),
    path: 'cockpit',
  },
  // Public pages: one address per language, the same path after the prefix.
  {
    canMatch: [languageAddress],
    children: [
      { component: Home, matcher: languageRoot },
      {
        loadComponent: () =>
          import('./public/reset-password/reset-password').then(
            (m) => m.ResetPassword,
          ),
        path: 'reset-password/:token',
      },
      {
        loadComponent: () =>
          import('./public/sign-in-return/sign-in-return').then(
            (m) => m.SignInReturn,
          ),
        path: 'sign-in/return',
      },
      placeholder('garages', 'public.placeholder.garages'),
      {
        loadComponent: () =>
          import('./public/garage-profile/garage-profile').then(
            (m) => m.GarageProfile,
          ),
        path: 'garages/:garage',
      },
      placeholder('mechanics/:mechanic', 'public.placeholder.mechanics'),
      {
        loadComponent: () =>
          import('./public/confirm-email/confirm-email').then(
            (m) => m.ConfirmEmail,
          ),
        path: 'confirm-email/:token',
      },
      {
        loadComponent: () =>
          import('./public/unsubscribe/unsubscribe').then((m) => m.Unsubscribe),
        path: 'unsubscribe/:token',
      },
      {
        loadComponent: () =>
          import('./public/invite/invite').then((m) => m.InvitePage),
        path: 'invite/:token',
      },
      {
        loadComponent: () =>
          import('./public/list-your-garage/list-your-garage').then(
            (m) => m.ListYourGarage,
          ),
        path: 'list-your-garage',
        title: () => inject(I18n).t('public.listing.heading'),
      },
      ...(['terms', 'privacy'] as const).map((text) => ({
        data: { text },
        loadComponent: () =>
          import('./public/legal/legal').then((m) => m.Legal),
        path: text,
      })),
      {
        ...placeholder('account', 'public.placeholder.account'),
        canActivate: [signedInToDashboard],
      },
    ],
    loadComponent: publicFrame,
    path: ':lang',
  },
  { component: NotFound, path: '**' },
];
