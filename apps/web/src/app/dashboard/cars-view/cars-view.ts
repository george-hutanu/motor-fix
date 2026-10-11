import {
  ChangeDetectionStrategy,
  Component,
  inject,
  type OnInit,
  signal,
} from '@angular/core';
import { groupPlate } from '@motor-fix/contracts/plate';
import { type CarDto, CarsService } from '@motor-fix/data-access';
import { I18n, KmPipe, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton, HlmPopoverImports } from '@motor-fix/ui-cockpit';

import type { DateField } from '../add-car/add-car';
import { openAddCar } from '../add-car/open-add-car';
import { DueDateLine } from '../due-date-line/due-date-line';
import { EmptyState } from '../empty-state/empty-state';
import { focusCard } from '../focus-card';
import { openRemoveCar } from '../remove-car/open-remove-car';

// "Mașinile mele": a card per car, newest first, and the button that adds one.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DueDateLine,
    EmptyState,
    HlmButton,
    HlmPopoverImports,
    KmPipe,
    TranslatePipe,
  ],
  selector: 'mf-cars-view',
  styleUrl: './cars-view.css',
  templateUrl: './cars-view.html',
})
export class CarsView implements OnInit {
  private readonly api = inject(CarsService);
  private readonly overlays = inject(Overlays);
  protected readonly cars = signal<CarDto[] | undefined>(undefined);
  protected readonly failed = signal(false);
  protected readonly grouped = groupPlate;
  private readonly i18n = inject(I18n);
  protected readonly language = this.i18n.language;

  constructor() {
    void this.i18n.enter('driver');
    focusCard('data-car', this.cars);
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
    const car = await openAddCar(this.overlays, plates);
    if (car !== 'cancelled') this.cars.update((list) => [car, ...(list ?? [])]);
  }

  // The answered car takes the card's place without reading the list again.
  protected async edit(car: CarDto, focus?: DateField) {
    const plates = (this.cars() ?? []).flatMap((c) => c.plate ?? []);
    const saved = await openAddCar(this.overlays, plates, {
      car,
      ...(focus && { focus }),
    });
    if (saved !== 'cancelled')
      this.cars.update((list) =>
        list?.map((c) => (c.id === saved.id ? saved : c)),
      );
  }

  // Once the removal is confirmed and done, the card leaves at once.
  protected async remove(car: CarDto) {
    if ((await openRemoveCar(this.overlays, car)) === true)
      this.cars.update((list) => list?.filter((c) => c.id !== car.id));
  }

  // The arrows move between the menu's items, wrapping.
  protected moveIn(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const menu = event.currentTarget as HTMLElement;
    const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const at = items.indexOf(menu.ownerDocument.activeElement as HTMLElement);
    const step = event.key === 'ArrowDown' ? 1 : items.length - 1;
    items[(at + step) % items.length]?.focus();
  }
}
