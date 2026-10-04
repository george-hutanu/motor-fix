import { OverlayPositionBuilder } from '@angular/cdk/overlay';
import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { BrnDialogService } from '@spartan-ng/brain/dialog';
import { firstValueFrom } from 'rxjs';

import { OverlayPanel, TABLET } from './panel';
import type {
  OverlayOptions,
  OverlayResult,
  OverlaySource,
  PanelContext,
} from './task';

let titles = 0;

// Opens a task on top of the current screen. The address never changes; the
// promise settles with the task's result, or "cancelled" when the person
// closed it (X, Escape, outside, a drag down, or the page navigating away).
// On a phone every shape opens as a bottom sheet.
@Injectable({ providedIn: 'root' })
export class Overlays {
  private readonly dialogs = inject(BrnDialogService);
  private readonly positions = inject(OverlayPositionBuilder);
  private readonly window = inject(DOCUMENT).defaultView;

  open<R = never, D = undefined>(
    source: OverlaySource,
    options: OverlayOptions<D>,
  ): Promise<OverlayResult<R>> {
    const titleId = `mf-overlay-title-${++titles}`;
    const sheet = !this.window?.matchMedia?.(TABLET).matches;
    const context: PanelContext = { ...options, sheet, source, titleId };
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
        positionStrategy: sheet
          ? this.positions.global().bottom('0').left('0')
          : options.shape === 'dialog'
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
