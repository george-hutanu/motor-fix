import {
  ChangeDetectionStrategy,
  Component,
  inject,
  type OnInit,
  signal,
} from '@angular/core';
import { groupPlate } from '@motor-fix/contracts/plate';
import { type CarDto, CarsService } from '@motor-fix/data-access';
import { DayPipe, I18n, KmPipe, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { AddCar } from './add-car';

// "Mașinile mele": a card per car, newest first, and the button that adds one.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DayPipe, HlmButton, KmPipe, TranslatePipe],
  selector: 'mf-cars-view',
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--mf-space-4); margin: var(--mf-space-4); min-width: 0; }
    .cards { display: grid; gap: var(--mf-space-3); grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); }
    article, .skeleton { border: 1px solid var(--mf-line-strong); border-radius: var(--mf-radius-md, 12px); min-width: 0; }
    article { display: flex; flex-direction: column; gap: var(--mf-space-1); padding: var(--mf-space-4); }
    .skeleton { height: 112px; background: var(--mf-line); }
    p { margin: 0; overflow-wrap: anywhere; }
    .name { font-weight: 700; }
    .muted { color: var(--mf-ink-muted); }
    button[hlmBtn] { width: 100%; white-space: normal; }
    @media (min-width: 390px) { button[hlmBtn] { width: auto; align-self: flex-start; } }
  `,
  template: `
    <button hlmBtn type="button" (click)="add()">{{ 'driver.cars.add.title' | t }}</button>
    @if (cars(); as list) {
      @if (list.length) {
        <div class="cards">
          @for (car of list; track car.id) {
            <article data-car>
              <p class="name">{{ car.brandName }} {{ car.model }}</p>
              <p>{{ car.year }} · {{ car.odometerKm | km }}</p>
              @if (car.itpUntil) {
                <p>{{ 'driver.cars.itpUntil' | t: { day: (car.itpUntil | day) } }}</p>
              } @else {
                <p class="muted">{{ 'driver.cars.itpMissing' | t }}</p>
              }
              @if (car.plate) {
                <p>{{ grouped(car.plate) }}</p>
              }
            </article>
          }
        </div>
      } @else {
        <p>{{ 'shell.frame.empty' | t }}</p>
      }
    } @else if (failed()) {
      <p role="alert">{{ 'shell.form.problem.error' | t }}</p>
      <button hlmBtn variant="secondary" type="button" (click)="load()">{{ 'driver.cars.retry' | t }}</button>
    } @else {
      <div class="cards" aria-busy="true">
        <div class="skeleton" aria-hidden="true"></div>
        <div class="skeleton" aria-hidden="true"></div>
      </div>
    }
  `,
})
export class CarsView implements OnInit {
  private readonly api = inject(CarsService);
  private readonly overlays = inject(Overlays);
  protected readonly cars = signal<CarDto[] | undefined>(undefined);
  protected readonly failed = signal(false);
  protected readonly grouped = groupPlate;

  constructor() {
    void inject(I18n).enter('driver');
  }

  ngOnInit() {
    void this.load();
  }

  protected async load() {
    this.failed.set(false);
    try {
      this.cars.set((await this.api.carsControllerList()).items);
    } catch {
      this.failed.set(true);
    }
  }

  // The saved car goes first without reading the list again.
  protected async add() {
    const plates = (this.cars() ?? []).flatMap((c) => c.plate ?? []);
    const car = await this.overlays.open<CarDto, { plates: string[] }>(AddCar, {
      data: { plates },
      shape: 'dialog',
      title: 'driver.cars.add.title',
    });
    if (car !== 'cancelled') this.cars.update((list) => [car, ...(list ?? [])]);
  }
}
