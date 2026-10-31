import { inject } from '@angular/core';
import type { Routes } from '@angular/router';
import { I18n } from '@motor-fix/i18n';

import { signedInToDashboard } from './account.guard';
import { Placeholder } from './placeholder/placeholder';
import { languageRoot } from '../addresses';
import { Home } from '../home/home';

const placeholder = (path: string, title: string) => ({
  component: Placeholder,
  data: { title },
  path,
});

// The public pages under the language prefix, one address per language.
export const publicChildren: Routes = [
  { component: Home, matcher: languageRoot },
  {
    loadComponent: () =>
      import('./reset-password/reset-password').then((m) => m.ResetPassword),
    path: 'reset-password/:token',
  },
  {
    loadComponent: () =>
      import('./sign-in-return/sign-in-return').then((m) => m.SignInReturn),
    path: 'sign-in/return',
  },
  {
    loadComponent: () => import('./results/results').then((m) => m.Results),
    path: 'garages',
  },
  {
    loadComponent: () =>
      import('./garage-profile/garage-profile').then((m) => m.GarageProfile),
    path: 'garages/:garage',
  },
  placeholder('mechanics/:mechanic', 'public.placeholder.mechanics'),
  {
    loadComponent: () =>
      import('./confirm-email/confirm-email').then((m) => m.ConfirmEmail),
    path: 'confirm-email/:token',
  },
  {
    loadComponent: () =>
      import('./unsubscribe/unsubscribe').then((m) => m.Unsubscribe),
    path: 'unsubscribe/:token',
  },
  {
    loadComponent: () => import('./invite/invite').then((m) => m.InvitePage),
    path: 'invite/:token',
  },
  {
    // A buyer's private link: never indexed (`addresses.ts`).
    data: { noindex: true },
    loadComponent: () =>
      import('./transfer/transfer').then((m) => m.TransferPage),
    path: 'transfer/:token',
  },
  {
    loadComponent: () =>
      import('./list-your-garage/list-your-garage').then(
        (m) => m.ListYourGarage,
      ),
    path: 'list-your-garage',
    title: () => inject(I18n).t('public.listing.heading'),
  },
  {
    loadComponent: () =>
      import('./contact/contact-page/contact-page').then((m) => m.ContactPage),
    path: 'contact',
    title: () => inject(I18n).t('public.contact.heading'),
  },
  ...(['terms', 'privacy'] as const).map((text) => ({
    data: { text },
    loadComponent: () => import('./legal/legal').then((m) => m.Legal),
    path: text,
    title: () => inject(I18n).t(`public.legal.${text}.title`),
  })),
  {
    loadComponent: () =>
      import('./review-rules/review-rules').then((m) => m.ReviewRules),
    path: 'review-rules',
    title: () => inject(I18n).t('public.reviewRules.title'),
  },
  {
    ...placeholder('account', 'public.placeholder.account'),
    canActivate: [signedInToDashboard],
  },
];
