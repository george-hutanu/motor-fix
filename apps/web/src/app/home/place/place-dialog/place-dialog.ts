import { Component } from '@angular/core';
import { roundCoordinate } from '@motor-fix/contracts/search-place';
import { injectOverlayTask } from '@motor-fix/overlays';

import {
  type AddressChoice,
  AddressField,
} from '../../../public/address-field/address-field';
import type { Place } from '../place-store';

// Where the search starts from: the browser's location, asked only on a tap,
// or an address picked from the look-up. The point is kept rounded.
@Component({
  imports: [AddressField],
  selector: 'mf-place-dialog',
  styleUrl: './place-dialog.css',
  templateUrl: './place-dialog.html',
})
export class PlaceDialog {
  private readonly task = injectOverlayTask<undefined, Place>();

  protected done({ label, lat, lng, origin }: AddressChoice) {
    this.task.close({
      label,
      lat: roundCoordinate(lat),
      lng: roundCoordinate(lng),
      origin,
    });
  }
}
