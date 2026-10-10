import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

// The tile a person chose on Home, kept for the visit: back from a garage
// card, Home shows it again instead of starting over at the first tile. Only
// the browser's back and forward bring it back; a new visit to Home starts at
// the first tile, and a brand found by search is never kept (230-FR-006).
@Injectable({ providedIn: 'root' })
export class BrandChoice {
  private readonly router = inject(Router);
  private slug: string | null = null;

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
