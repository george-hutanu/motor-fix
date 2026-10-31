import { DOCUMENT } from '@angular/common';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
} from '@angular/core';
import { groupPlate } from '@motor-fix/contracts/plate';
import { type CarDto, CarsService } from '@motor-fix/data-access';
import { formatDayMonth, I18n, KmPipe, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton, HlmPopoverImports } from '@motor-fix/ui-cockpit';

import { openCancelTransfer } from './cancel-transfer/open-cancel-transfer';
import { openSellCar } from './sell-car/open-sell-car';
import type { CarFocus } from '../add-car/add-car';
import { openAddCar } from '../add-car/open-add-car';
import { DueDateLine } from '../due-date-line/due-date-line';
import { EmptyState } from '../empty-state/empty-state';
import { focusCard } from '../focus-card';
import { OilLine } from '../oil-line/oil-line';
import { openRemoveCar } from '../remove-car/open-remove-car';
import { Resources } from '../resources/resources';

// "Mașinile mele": a card per car, newest first, and the button that adds one.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DueDateLine,
    OilLine,
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
export class CarsView {
  private readonly api = inject(CarsService);
  private readonly overlays = inject(Overlays);
  private readonly resources = inject(Resources);
  private readonly read = this.resources.live(
    'cars',
    () => this.api.carsControllerList().then(({ items }) => items),
    // A transfer's change shows on its car's card.
    [
      'car_transfer.sent',
      'car_transfer.cancelled',
      'car_transfer.expired',
      'car_transfer.accepted',
    ],
  );
  protected readonly cars = this.read.value;
  // A retry shows the placeholder until it answers.
  protected readonly failed = computed(
    () =>
      this.read.failed() && !this.read.isLoading() && this.cars() === undefined,
  );
  protected readonly grouped = groupPlate;
  private readonly i18n = inject(I18n);
  protected readonly language = this.i18n.language;

  // After a sale or a cancel the card swaps its "⋯" and its transfer line, so
  // the button that opened the dialog may be gone: once the re-read draws the
  // card, a focus left on nothing goes to the card.
  private refocus?: string;

  constructor() {
    void this.i18n.enter('driver');
    focusCard('data-car', this.cars);
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const document = inject(DOCUMENT);
    afterRenderEffect(() => {
      this.cars();
      const id = this.refocus;
      if (!id) return;
      this.refocus = undefined;
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      host.querySelector<HTMLElement>(`[data-car="${id}"]`)?.focus();
    });
  }

  protected load() {
    void this.read.reload();
  }

  // The saved car goes first without reading the list again.
  protected async add() {
    const plates = (this.cars() ?? []).flatMap((c) => c.plate ?? []);
    const car = await openAddCar(this.overlays, plates);
    if (car !== 'cancelled')
      this.resources.update('cars', (list) => [car, ...list]);
  }

  // The answered car takes the card's place without reading the list again.
  protected async edit(car: CarDto, focus?: CarFocus) {
    const plates = (this.cars() ?? []).flatMap((c) => c.plate ?? []);
    const saved = await openAddCar(this.overlays, plates, {
      car,
      ...(focus && { focus }),
      gone: () => this.drop(car),
    });
    if (saved !== 'cancelled')
      this.resources.update('cars', (list) =>
        list.map((c) => (c.id === saved.id ? saved : c)),
      );
  }

  // Once the removal is confirmed and done, the card leaves at once.
  protected async remove(car: CarDto) {
    if ((await openRemoveCar(this.overlays, car)) === true) this.drop(car);
  }

  // "Am vândut mașina": a "no" to passing the history goes on to the removal;
  // any other close may have sent a link, so the cars are read again.
  protected async sell(car: CarDto) {
    const answer = await openSellCar(this.overlays, car);
    if (answer === 'remove') return this.remove(car);
    this.refocus = car.id;
    this.load();
  }

  // The cancel may have been refused because the transfer ended meanwhile,
  // so the cars are read again whatever the answer.
  protected async cancelTransfer(car: CarDto) {
    await openCancelTransfer(this.overlays, car);
    this.refocus = car.id;
    this.load();
  }

  protected transferDay(expiresAt: string) {
    return formatDayMonth(expiresAt, this.language());
  }

  private drop(car: CarDto) {
    this.resources.update('cars', (list) =>
      list.filter((c) => c.id !== car.id),
    );
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
