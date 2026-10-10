import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  inject,
  PLATFORM_ID,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { Consent } from '../consent';

// The analytics question at the bottom of every page while no valid choice
// holds: two answers of equal weight, never in the way of the page.
@Component({
  imports: [HlmButton, RouterLink, TranslatePipe],
  selector: 'mf-consent-bar',
  styleUrl: './consent-bar.css',
  templateUrl: './consent-bar.html',
})
export class ConsentBar {
  protected readonly consent = inject(Consent);
  protected readonly i18n = inject(I18n);

  constructor() {
    if (
      !isPlatformBrowser(inject(PLATFORM_ID)) ||
      typeof ResizeObserver === 'undefined'
    )
      return;
    // Its height, 0 once answered, as --consent-bar: a page's own pinned
    // buttons (the listing's Save) sit on it instead of under it.
    const root = inject(DOCUMENT).documentElement;
    const observer = new ResizeObserver(([entry]) =>
      root.style.setProperty(
        '--consent-bar',
        `${Math.ceil(entry?.contentRect.height ?? 0)}px`,
      ),
    );
    observer.observe(inject(ElementRef).nativeElement);
    inject(DestroyRef).onDestroy(() => {
      observer.disconnect();
      root.style.removeProperty('--consent-bar');
    });
  }
}
