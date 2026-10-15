import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import {
  ApiConfiguration,
  type PublicGarageDto,
  publicGaragesControllerBySlug,
} from '@motor-fix/data-access';
import type { Subscription } from 'rxjs';

import { measure } from '../../telemetry/browser/measure/measure';

const CAP = 3;
const LIFE_MS = 120_000;
const GONE = [404, 410];
const SLOW = ['2g', 'slow-2g'];

type Entry = { at: number; garage?: PublicGarageDto };
type Wanted = { key: string; slug: string; brand: string | undefined };
type Outcome = 'fetched' | 'cancelled' | 'hit' | 'expired' | 'skipped';

// A pair, so no slug and brand can spell another garage's key.
const keyOf = (slug: string, brand: string | undefined) =>
  JSON.stringify([slug, brand ?? '']);

// Public profiles read ahead of a likely open from the results, kept for
// 120 s for the profile page to draw from. A read only: it records no view.
@Injectable({ providedIn: 'root' })
export class ProfilePrefetch {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApiConfiguration);
  private readonly document = inject(DOCUMENT);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  // A remembered not found or gone has no garage.
  private readonly entries = new Map<string, Entry>();
  private readonly flights = new Map<string, Subscription>();
  private waiting: Wanted[] = [];
  private preloaded = false;
  private skipped = false;

  want(slug: string, brand: string | undefined): void {
    if (!this.browser) return;
    if (!this.allowed()) {
      if (!this.skipped) this.report('skipped');
      this.skipped = true;
      return;
    }
    const key = keyOf(slug, brand);
    const entry = this.entries.get(key);
    if (entry && this.young(entry)) return;
    this.entries.delete(key);
    if (this.flights.has(key) || this.waiting.some((w) => w.key === key))
      return;
    if (!this.preloaded) {
      this.preloaded = true;
      this.preload().catch(() => undefined);
    }
    this.waiting.push({ brand, key, slug });
    this.pump();
  }

  cancel(slug: string, brand: string | undefined): void {
    const key = keyOf(slug, brand);
    this.waiting = this.waiting.filter((w) => w.key !== key);
    const flight = this.flights.get(key);
    if (!flight) return;
    this.report('cancelled');
    flight.unsubscribe();
  }

  take(slug: string, brand: string | undefined): PublicGarageDto | undefined {
    const key = keyOf(slug, brand);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (!this.young(entry)) {
      this.entries.delete(key);
      this.report('expired');
      return undefined;
    }
    if (entry.garage) this.report('hit');
    return entry.garage;
  }

  // The profile route's own chunk, so opening the card loads no code.
  private preload(): Promise<unknown> {
    return import('../garage-profile/garage-profile');
  }

  private allowed(): boolean {
    const connection = (
      this.document.defaultView?.navigator as
        | { connection?: { saveData?: boolean; effectiveType?: string } }
        | undefined
    )?.connection;
    return (
      !connection?.saveData &&
      !SLOW.includes(connection?.effectiveType ?? '') &&
      this.document.visibilityState === 'visible'
    );
  }

  private young(entry: Entry): boolean {
    return Date.now() - entry.at < LIFE_MS;
  }

  private pump(): void {
    while (this.flights.size < CAP && this.waiting.length > 0) {
      const { brand, key, slug } = this.waiting.shift() as Wanted;
      const started = Date.now();
      const flight = publicGaragesControllerBySlug(
        this.http,
        this.config.rootUrl,
        { slug, ...(brand ? { brand } : {}) },
      ).subscribe({
        error: (failure: unknown) => {
          if (
            failure instanceof HttpErrorResponse &&
            GONE.includes(failure.status)
          )
            this.entries.set(key, { at: Date.now() });
        },
        next: ({ body }) => {
          // An empty answer is no garage to draw: the page reads its own.
          if (!body) return;
          this.entries.set(key, { at: Date.now(), garage: body });
          this.report('fetched', Date.now() - started);
        },
      });
      if (flight.closed) continue;
      this.flights.set(key, flight);
      flight.add(() => {
        this.flights.delete(key);
        this.pump();
      });
    }
  }

  private report(outcome: Outcome, duration = 0): void {
    measure('prefetch', { duration }, { outcome, path: 'profile' });
  }
}
