import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
} from '@angular/core';
import {
  provideClientHydration,
  withEventReplay,
  withHttpTransferCacheOptions,
} from '@angular/platform-browser';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { provideI18n, provideRememberedLanguage } from '@motor-fix/i18n';
import { provideCockpitTheme } from '@motor-fix/ui-cockpit';

import { provideLanguageAddresses } from './addresses';
import { routes } from './app.routes';
import { authInterceptor } from './auth.interceptor';
import { PlatformStatus } from './maintenance/platform-status';
import { transferCacheFilter } from './public-read';
import { provideViewScrolling } from './scrolling';
import { serverTimeoutInterceptor } from './server-timeout.interceptor';
import { provideServiceWorkerRecovery } from './service-worker-recovery';
import { provideHomeVisit } from './voice/home-visit/home-visit';
import { provideVoiceRead } from './voice/voice';

// On the server, withFetch sends every API call through Node's global fetch,
// whose one undici dispatcher keeps its connections alive between calls.
export const apiHttpClient = () =>
  provideHttpClient(
    withFetch(),
    withInterceptors([authInterceptor, serverTimeoutInterceptor]),
  );

export const appConfig: ApplicationConfig = {
  providers: [
    // A tap on the server-rendered page before hydration is replayed, not lost.
    provideClientHydration(
      withEventReplay(),
      withHttpTransferCacheOptions({ filter: transferCacheFilter }),
    ),
    apiHttpClient(),
    provideRouter(routes, withInMemoryScrolling()),
    provideViewScrolling(),
    provideI18n(),
    provideCockpitTheme(),
    provideRememberedLanguage(),
    provideLanguageAddresses(),
    // Before the first render, so a visit during maintenance opens on its page.
    provideAppInitializer(() => inject(PlatformStatus).read()),
    provideVoiceRead(),
    provideHomeVisit(),
    // Only the production build emits ngsw-worker.js.
    provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode() }),
    provideServiceWorkerRecovery(),
  ],
};
