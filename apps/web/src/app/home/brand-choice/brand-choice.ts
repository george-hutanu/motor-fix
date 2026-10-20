import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

// The tile a person chose on Home, kept for the visit: back from a garage
// card, Home shows it again instead of starting over at the first tile. Only
// the browser's back and forward bring it back; a new visit to Home starts at
// the first tile, and a brand found by search is never kept.
@Injectable({ providedIn: 'root' })
export class BrandChoice {
  private readonly router = inject(Router);
  private slug: string | null = null;
  // The brand Home shows right now, for the site bar's "Găsește un mecanic";
  // none while Home is not on screen.
  readonly shown = signal<string | null>(null);

  // Read while Home is being created, inside the navigation that opens it.
  kept(): string | null {
    return this.router.currentNavigation()?.trigger === 'popstate'
      ? this.slug
      : null;
  }

  keep(slug: string | null) {
    this.slug = slug;
  }
}
