import { inject } from '@angular/core';
import type { Routes } from '@angular/router';
import { I18n } from '@motor-fix/i18n';

import {
  cockpitTexts,
  languageAddress,
  languageRoot,
  publicTexts,
  toLanguageAddress,
} from './addresses';
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
  // In the public frame, like /ro, so the server's page has its landmarks too.
  // `toLanguageAddress` first: its redirect wins without waiting for the texts.
  {
    canMatch: [toLanguageAddress, publicTexts],
    children: [{ component: Home, path: '' }],
    component: PublicFrame,
    data: { tabBar: false },
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
          import('./public/reset-password').then((m) => m.ResetPassword),
        path: 'reset-password/:token',
      },
      {
        loadComponent: () =>
          import('./public/sign-in-return').then((m) => m.SignInReturn),
        path: 'sign-in/return',
      },
      placeholder('garages', 'public.placeholder.garages'),
      placeholder('garages/:garage', 'public.placeholder.garages'),
      placeholder('mechanics/:mechanic', 'public.placeholder.mechanics'),
      {
        loadComponent: () =>
          import('./public/confirm-email').then((m) => m.ConfirmEmail),
        path: 'confirm-email/:token',
      },
      {
        loadComponent: () =>
          import('./public/unsubscribe').then((m) => m.Unsubscribe),
        path: 'unsubscribe/:token',
      },
      {
        loadComponent: () =>
          import('./public/invite').then((m) => m.InvitePage),
        path: 'invite/:token',
      },
      {
        loadComponent: () =>
          import('./public/list-your-garage').then((m) => m.ListYourGarage),
        path: 'list-your-garage',
        title: () => inject(I18n).t('public.listing.heading'),
      },
      ...(['terms', 'privacy'] as const).map((text) => ({
        data: { text },
        loadComponent: () => import('./public/legal').then((m) => m.Legal),
        path: text,
      })),
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
