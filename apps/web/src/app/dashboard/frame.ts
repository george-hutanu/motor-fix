import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { MeDto } from '@motor-fix/data-access';
import { AsWritten, LanguageSwitch, TranslatePipe } from '@motor-fix/i18n';

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
  imports: [AsWritten, LanguageSwitch, RouterLink, TranslatePipe],
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
  `,
})
export class Frame {
  protected readonly session = inject(Session);
  private readonly router = inject(Router);
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

  protected signOut() {
    this.session.current.set(null);
    void this.router.navigateByUrl('/');
  }
}
