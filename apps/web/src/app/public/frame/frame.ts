import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { I18n, LanguageSwitch, TranslatePipe } from '@motor-fix/i18n';
import { HlmToaster } from '@motor-fix/ui-cockpit';
import { filter } from 'rxjs';

import { ConsentBar } from '../../consent/consent-bar/consent-bar';
import { Session } from '../../dashboard/session';
import { BrandChoice } from '../../home/brand-choice/brand-choice';
import { SignInDialog } from '../../sign-in/sign-in-dialog';
import { PublicFooter } from '../footer/footer';
import { PublicTabBar } from '../tab-bar/tab-bar';

// Full height, so the sticky tab bar sits at the bottom of a short page too.
// The site bar on top is the same on every public page: its links show from
// 640 px; narrower, an account button stands in for them beside the language
// switch, and the tab bar does the rest.
@Component({
  host: { '[class.no-tab-bar]': '!tabBar' },
  imports: [
    ConsentBar,
    HlmToaster,
    LanguageSwitch,
    PublicFooter,
    RouterLink,
    RouterOutlet,
    PublicTabBar,
    TranslatePipe,
  ],
  selector: 'mf-public-frame',
  styleUrl: './frame.css',
  templateUrl: './frame.html',
})
export class PublicFrame {
  protected readonly signIn = inject(SignInDialog);
  protected readonly i18n = inject(I18n);
  // `/` turns this off: its server render is for search engines.
  protected readonly tabBar =
    inject(ActivatedRoute).snapshot.data['tabBar'] !== false;

  private readonly router = inject(Router);
  // Results names the link home "Căutare nouă".
  protected readonly onResults = signal(this.isResults());
  // Set only once some other screen loaded it: a public page never asks.
  private readonly session = inject(Session).current;
  protected readonly signedIn = computed(() => this.session() !== null);
  private readonly shown = inject(BrandChoice).shown;
  // On Home, "Găsește un mecanic" opens Results for the brand shown.
  protected readonly find = computed(() => {
    const language = this.i18n.language();
    const brand = this.shown();
    return brand
      ? { commands: ['/', language, 'garages'], query: { brand } }
      : { commands: ['/', language], query: {} };
  });

  constructor() {
    // A signed-out visit to a dashboard lands here asking for sign-in.
    const router = this.router;
    router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        this.onResults.set(this.isResults());
        if (router.currentNavigation()?.extras.state?.['signIn']) {
          void this.signIn.start({ signedOut: true });
        }
      });
  }

  // Followed on Home itself, the address does not change: the navigation is
  // made to run again so the section is scrolled to and focused once more.
  protected howItWorks(event: MouseEvent) {
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    void this.router.navigate(['/', this.i18n.language()], {
      fragment: 'how-it-works',
      onSameUrlNavigation: 'reload',
    });
  }

  private isResults() {
    return /^\/[a-z]{2}\/garages(\?|$)/.test(this.router.url);
  }
}
