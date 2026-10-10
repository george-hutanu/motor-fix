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
import { HlmButton } from '@motor-fix/ui-cockpit';

import { openAddCar } from '../add-car/open-add-car';
import { DueDateLine } from '../due-date-line/due-date-line';
import { EmptyState } from '../empty-state/empty-state';

// "Mașinile mele": a card per car, newest first, and the button that adds one.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DueDateLine, EmptyState, HlmButton, KmPipe, TranslatePipe],
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
}
