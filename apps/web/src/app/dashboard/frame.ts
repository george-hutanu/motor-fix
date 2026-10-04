import {
  Component,
  computed,
  DestroyRef,
  inject,
  type OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import type { MeDto } from '@motor-fix/data-access';
import {
  AsWritten,
  I18n,
  LanguageSwitch,
  TranslatePipe,
} from '@motor-fix/i18n';
import { HlmToaster, toast } from '@motor-fix/ui-cockpit';

import { Live } from './live';
import { Session } from './session';

// `label` and `tag` are shell translation keys.
interface Entry {
  label: string;
  // Absent: every role of the area sees it.
  capability?: string;
}

const MENUS: Record<MeDto['landing'], { tag: string; entries: Entry[] }> = {
  '/app/admin': {
    entries: [
      { label: 'shell.frame.nav.dashboard' },
      { capability: 'admin.garages', label: 'shell.frame.nav.admin.garages' },
      { capability: 'admin.users', label: 'shell.frame.nav.admin.users' },
      { capability: 'admin.reviews', label: 'shell.frame.nav.admin.reviews' },
      {
        capability: 'admin.catalogue',
        label: 'shell.frame.nav.admin.catalogue',
      },
      { capability: 'admin.settings', label: 'shell.frame.nav.admin.settings' },
    ],
    tag: 'shell.frame.area.admin',
  },
  '/app/driver': {
    entries: [
      { label: 'shell.frame.nav.dashboard' },
      {
        capability: 'driver.requests',
        label: 'shell.frame.nav.driver.requests',
      },
      { capability: 'driver.cars', label: 'shell.frame.nav.driver.cars' },
      { capability: 'driver.reviews', label: 'shell.frame.nav.driver.reviews' },
      {
        capability: 'driver.saved_garages',
        label: 'shell.frame.nav.driver.savedGarages',
      },
      {
        capability: 'driver.settings',
        label: 'shell.frame.nav.driver.settings',
      },
    ],
    tag: 'shell.frame.area.driver',
  },
  '/app/garage': {
    entries: [
      { label: 'shell.frame.nav.dashboard' },
      {
        capability: 'garage.requests',
        label: 'shell.frame.nav.garage.requests',
      },
      {
        capability: 'garage.schedule',
        label: 'shell.frame.nav.garage.schedule',
      },
      { capability: 'garage.team', label: 'shell.frame.nav.garage.team' },
      { capability: 'garage.prices', label: 'shell.frame.nav.garage.prices' },
      { capability: 'garage.reviews', label: 'shell.frame.nav.garage.reviews' },
      { capability: 'garage.profile', label: 'shell.frame.nav.garage.profile' },
    ],
    tag: 'shell.frame.area.garage',
  },
};

@Component({
  imports: [AsWritten, HlmToaster, LanguageSwitch, RouterLink, TranslatePipe],
  selector: 'mf-frame',
  styles: `
    :host { display: grid; grid-template-columns: minmax(0, 16rem) minmax(0, 1fr); min-height: 100vh; }
    aside { display: flex; flex-direction: column; gap: 1.25rem; padding: 1rem; }
    nav { display: flex; flex-direction: column; gap: 0.25rem; }
    .account { margin-top: auto; display: flex; flex-direction: column; gap: 0.25rem; }
    @media (max-width: 48rem) { :host { grid-template-columns: minmax(0, 1fr); } }
  `,
  template: `
    <aside>
      <a routerLink="/" [attr.aria-label]="'shell.frame.home' | t">{{ 'shell.frame.logo' | t }}</a>
      <span>{{ menu().tag | t }}</span>
      <nav [attr.aria-label]="'shell.frame.menu' | t">
        @for (entry of entries(); track entry.label) {
          <button type="button" [attr.aria-pressed]="entry.label === view()" (click)="view.set(entry.label)">
            {{ entry.label | t }}
          </button>
        }
      </nav>
      <div class="account">
        <mf-as-written [text]="session.current()?.name ?? ''" />
        <button type="button" (click)="signOut()">{{ 'shell.frame.signOut' | t }}</button>
      </div>
    </aside>
    <div>
      <header><h1>{{ view() | t }}</h1><mf-language-switch /></header>
      <main><p>{{ 'shell.frame.empty' | t }}</p></main>
    </div>
    <hlm-toaster />
  `,
})
export class Frame implements OnInit {
  protected readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly live = inject(Live);
  private readonly i18n = inject(I18n);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly menu = computed(
    () => MENUS[this.session.current()?.landing ?? '/app/driver'],
  );
  protected readonly entries = computed(() => {
    const allowed = this.session.current()?.capabilities ?? [];
    return this.menu().entries.filter(
      (e) => !e.capability || allowed.includes(e.capability),
    );
  });
  protected readonly view = signal('shell.frame.nav.dashboard');

  // The frame holds the tab's live connection for as long as it is shown.
  ngOnInit() {
    this.live.events
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((message) => {
        if (message.kind === 'live.test') toast(this.i18n.t('shell.live.test'));
      });
    this.live.open();
    this.destroyRef.onDestroy(() => this.live.close());
  }

  protected async signOut() {
    this.live.close();
    await this.session.signOut();
    await this.router.navigateByUrl('/');
  }
}
