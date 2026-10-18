import { isPlatformBrowser } from '@angular/common';
import { Injectable, inject, PLATFORM_ID, signal } from '@angular/core';
import type { PublicGarageDto } from '@motor-fix/data-access';

const key = (garageId: string) => `mf.estimate.${garageId}`;

// The jobs a visitor has switched on in a garage's price list, shared by the
// list and the estimate box of one profile page and kept for the browser
// session under the garage. Storage is a convenience: a refused or malformed
// entry reads as nothing on, and the server keeps the selection in memory only.
@Injectable()
export class PriceSelection {
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private garageId: string | undefined;
  private listed: ReadonlySet<string> = new Set();

  readonly on = signal<ReadonlySet<string>>(new Set());
  // A job switched on that the latest read no longer lists was switched off.
  readonly dropped = signal(false);
  // True once the visitor switches a job here, so a page load stays silent.
  readonly touched = signal(false);
  // True once the browser has applied the jobs kept for the session, so the
  // bar does not flash "nothing on" before them. The server never applies.
  readonly applied = signal(false);

  sync(garage: PublicGarageDto) {
    const listed = new Set(garage.prices.map((price) => price.jobTypeId));
    this.listed = listed;
    const fresh = garage.id !== this.garageId;
    const before = fresh ? this.read(garage.id) : [...this.on()];
    this.garageId = garage.id;
    const kept = before.filter((id) => listed.has(id));
    if (fresh) {
      this.dropped.set(false);
      this.touched.set(false);
    } else if (kept.length < before.length) {
      this.dropped.set(true);
    }
    if (fresh || kept.length < before.length) {
      this.on.set(new Set(kept));
      this.write();
    }
    if (this.browser) this.applied.set(true);
  }

  toggle(id: string, checked: boolean) {
    if (checked && !this.listed.has(id)) return;
    const next = new Set(this.on());
    if (checked) next.add(id);
    else next.delete(id);
    this.on.set(next);
    this.dropped.set(false);
    this.touched.set(true);
    this.write();
  }

  private read(garageId: string): string[] {
    if (!this.browser) return [];
    try {
      const value: unknown = JSON.parse(
        sessionStorage.getItem(key(garageId)) ?? '[]',
      );
      return Array.isArray(value) && value.every((id) => typeof id === 'string')
        ? value
        : [];
    } catch {
      return [];
    }
  }

  private write() {
    if (!this.browser || this.garageId === undefined) return;
    try {
      sessionStorage.setItem(
        key(this.garageId),
        JSON.stringify([...this.on()]),
      );
    } catch {
      // Storage refused: the open page keeps its selection.
    }
  }
}
