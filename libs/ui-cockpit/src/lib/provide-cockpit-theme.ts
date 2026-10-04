import { OVERLAY_DEFAULT_CONFIG } from '@angular/cdk/overlay';
import {
  type EnvironmentProviders,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
} from '@angular/core';
import { Meta } from '@angular/platform-browser';

// --mf-bg of each set in cockpit.css; a meta tag cannot read a CSS variable.
const BROWSER_BAR = { dark: '#0b0c0e', light: '#f4f4f1' };

// The colour scheme follows the device in cockpit.css alone. Overlays stay
// out of the browser top layer so the toaster is drawn above dialogs.
export function provideCockpitTheme(): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: OVERLAY_DEFAULT_CONFIG, useValue: { usePopover: false } },
    provideEnvironmentInitializer(() => {
      const meta = inject(Meta);
      for (const [scheme, content] of Object.entries(BROWSER_BAR)) {
        meta.addTag({
          content,
          media: `(prefers-color-scheme: ${scheme})`,
          name: 'theme-color',
        });
      }
    }),
  ]);
}
