import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { type CarDto, CarsService } from '@motor-fix/data-access';

import { moreRows } from '../../garage-requests/more-rows/more-rows';
import { SavedGaragesList } from '../saved-garages-list';
import { SavedGaragesPanel } from '../saved-garages-panel/saved-garages-panel';

// Service-uri salvate (/app/driver/saved): the whole list, a page at a time
// as its end comes into view, under the count of those that work on the
// driver's cars.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SavedGaragesPanel],
  selector: 'mf-saved-garages-view',
  styleUrl: './saved-garages-view.css',
  templateUrl: './saved-garages-view.html',
})
export class SavedGaragesView {
  private readonly list = inject(SavedGaragesList);
  private readonly carsApi = inject(CarsService);
  private readonly end = viewChild<ElementRef<HTMLElement>>('end');
  protected readonly more = moreRows(
    this.list.reads,
    this.list.nextCursor,
    (cursor) => this.list.page(cursor),
    this.end,
  );
  // Undefined until read, and when the read fails: no row asks for a car then.
  protected readonly cars = signal<readonly CarDto[] | undefined>(undefined);

  constructor() {
    this.carsApi.carsControllerList().then(
      (page) => this.cars.set(page.items),
      () => undefined,
    );
  }
}
