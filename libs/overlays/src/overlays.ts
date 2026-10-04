import { OverlayPositionBuilder } from '@angular/cdk/overlay';
import { Injectable, inject } from '@angular/core';
import { BrnDialogService } from '@spartan-ng/brain/dialog';
import { firstValueFrom } from 'rxjs';

import { OverlayPanel } from './panel';
import type {
  OverlayOptions,
  OverlayResult,
  OverlaySource,
  PanelContext,
} from './task';

let titles = 0;

// Opens a task on top of the current screen. The address never changes; the
// promise settles with the task's result, or "cancelled" when the person
// closed it (X, Escape, outside, or the page navigating away).
@Injectable({ providedIn: 'root' })
export class Overlays {
  private readonly dialogs = inject(BrnDialogService);
  private readonly positions = inject(OverlayPositionBuilder);

  open<R = never, D = undefined>(
    source: OverlaySource,
    options: OverlayOptions<D>,
  ): Promise<OverlayResult<R>> {
    const titleId = `mf-overlay-title-${++titles}`;
    const context: PanelContext = { ...options, source, titleId };
    const ref = this.dialogs.open<PanelContext, R>(
      OverlayPanel,
      undefined,
      context,
      {
        ariaLabelledBy: titleId,
        ariaModal: true,
        autoFocus: false,
        backdropClass: 'spartan-dialog-overlay',
        // The panel decides on Escape and outside clicks: it may ask first.
        closeOnOutsidePointerEvents: false,
        disableClose: true,
        positionStrategy:
          options.shape === 'dialog'
            ? undefined
            : this.positions.global().top('0').right('0'),
        restoreFocus: true,
        role: 'dialog',
      },
    );
    return firstValueFrom(ref.closed$, { defaultValue: undefined }).then(
      (result) => result ?? 'cancelled',
    );
  }
}
