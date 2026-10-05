import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterOutlet,
} from '@angular/router';
import { TranslatePipe } from '@motor-fix/i18n';
import { filter } from 'rxjs';

import { PublicTabBar } from './tab-bar';
import { SignInDialog } from '../sign-in/sign-in-dialog';

// Full height, so the sticky bar sits at the bottom of a short page too. On
// wider screens, where there is no tab bar, a top bar holds "Autentificare"
// until the public header exists.
@Component({
  imports: [RouterOutlet, PublicTabBar, TranslatePipe],
  selector: 'mf-public-frame',
  styles: `
    :host { display: flex; flex-direction: column; min-height: 100dvh; }
    main { flex: 1 0 auto; }
    .top { display: none; }
    @media (min-width: 768px) {
      .top { display: flex; justify-content: flex-end; padding: var(--mf-space-3) var(--mf-space-4) 0; }
    }
  `,
  template: `
    <header class="top">
      <button type="button" class="spartan-button spartan-button-variant-ghost" (click)="signIn.start()">
        {{ 'public.signInButton' | t }}
      </button>
    </header>
    <main><router-outlet /></main>
    @if (tabBar) {
      <mf-public-tab-bar />
    }
  `,
})
export class PublicFrame {
  protected readonly signIn = inject(SignInDialog);
  // `/` turns this off: its server render is for search engines (ST-287).
  protected readonly tabBar =
    inject(ActivatedRoute).snapshot.data['tabBar'] !== false;

  constructor() {
    // A signed-out visit to a dashboard lands here asking for sign-in.
    const router = inject(Router);
    router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        if (router.currentNavigation()?.extras.state?.['signIn']) {
          void this.signIn.start();
        }
      });
  }
}
