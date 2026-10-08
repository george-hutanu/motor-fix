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

import { SignInDialog } from '../../sign-in/sign-in-dialog';
import { PublicTabBar } from '../tab-bar/tab-bar';

// Full height, so the sticky bar sits at the bottom of a short page too. On
// wider screens, where there is no tab bar, a top bar holds "Autentificare"
// until the public header exists.
@Component({
  imports: [RouterOutlet, PublicTabBar, TranslatePipe],
  selector: 'mf-public-frame',
  styleUrl: './frame.css',
  templateUrl: './frame.html',
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
