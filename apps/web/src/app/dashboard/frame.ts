import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { MeDto } from '@motor-fix/data-access';

import { Session } from './session';

interface Entry {
  label: string;
  // Absent: every role of the area sees it.
  capability?: string;
}

const MENUS: Record<MeDto['landing'], { tag: string; entries: Entry[] }> = {
  '/app/admin': {
    entries: [
      { label: 'Panou' },
      { capability: 'admin.garages', label: 'Service-uri' },
      { capability: 'admin.users', label: 'Utilizatori' },
      { capability: 'admin.reviews', label: 'Recenzii raportate' },
      { capability: 'admin.catalogue', label: 'Mărci și lucrări' },
      { capability: 'admin.settings', label: 'Setări' },
    ],
    tag: 'Admin',
  },
  '/app/driver': {
    entries: [
      { label: 'Panou' },
      { capability: 'driver.requests', label: 'Cererile mele' },
      { capability: 'driver.cars', label: 'Mașinile mele' },
      { capability: 'driver.reviews', label: 'Recenziile mele' },
      { capability: 'driver.saved_garages', label: 'Service-uri salvate' },
      { capability: 'driver.settings', label: 'Setări' },
    ],
    tag: 'Șofer',
  },
  '/app/garage': {
    entries: [
      { label: 'Panou' },
      { capability: 'garage.requests', label: 'Cereri de ofertă' },
      { capability: 'garage.schedule', label: 'Programări' },
      { capability: 'garage.team', label: 'Mecanici' },
      { capability: 'garage.prices', label: 'Prețuri' },
      { capability: 'garage.reviews', label: 'Recenzii' },
      { capability: 'garage.profile', label: 'Profilul service-ului' },
    ],
    tag: 'Service',
  },
};

@Component({
  imports: [RouterLink],
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
      <a routerLink="/" aria-label="MotorFix, pagina principală">MOTORFIX</a>
      <span>{{ menu().tag }}</span>
      <nav aria-label="Meniu">
        @for (entry of entries(); track entry.label) {
          <button type="button" [attr.aria-pressed]="entry.label === view()" (click)="view.set(entry.label)">
            {{ entry.label }}
          </button>
        }
      </nav>
      <div class="account">
        <span>{{ session.current()?.name }}</span>
        <button type="button" (click)="signOut()">Ieși din cont</button>
      </div>
    </aside>
    <div>
      <header><h1>{{ view() }}</h1></header>
      <main><p>Nimic aici încă.</p></main>
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
  protected readonly view = signal('Panou');

  protected signOut() {
    this.session.current.set(null);
    void this.router.navigateByUrl('/');
  }
}
