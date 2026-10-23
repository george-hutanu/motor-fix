import { OVERLAY_DEFAULT_CONFIG } from '@angular/cdk/overlay';
import {
  type EnvironmentProviders,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
} from '@angular/core';
import { Meta } from '@angular/platform-browser';

import { COCKPIT_COLOURS } from '../generated/colours';

// A meta tag cannot read a CSS variable, so the bar takes --mf-bg generated from cockpit.css.
const BROWSER_BAR = {
  dark: COCKPIT_COLOURS.dark['--mf-bg'],
  light: COCKPIT_COLOURS.light['--mf-bg'],
};

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
