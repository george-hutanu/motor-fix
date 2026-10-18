import {
  DEFAULT_DIALOG_CONFIG,
  Dialog,
  DialogConfig,
} from '@angular/cdk/dialog';
import { OverlayPositionBuilder } from '@angular/cdk/overlay';
import { DOCUMENT } from '@angular/common';
import {
  createEnvironmentInjector,
  DestroyRef,
  EnvironmentInjector,
  Injectable,
  inject,
} from '@angular/core';
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

// Moves the focus to the page's first <main>, making it focusable from
// script (tabindex -1) when it is not already. The skip link uses it, and so
// does a closing task whose opener has left the page. False when there is no
// main to take it.
export function focusMain(document: Document): boolean {
  const main = document.querySelector('main');
  if (!main) return false;
  if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  main.focus();
  return true;
}

// Opens a task on top of the current screen. The address never changes; the
// promise settles with the task's result, or "cancelled" when the person
// closed it (X, Escape, outside, a drag down, or the browser's Back button).
// On a phone every shape opens as a bottom sheet.
@Injectable({ providedIn: 'root' })
export class Overlays {
  // The CDK's default closes every open dialog on any popstate, the panel's
  // own history entry included; the panel handles Back itself, one task at a
  // time. Only these dialogs opt out: the kit's other dialogs keep the default.
  private readonly scope = createEnvironmentInjector(
    [
      {
        provide: DEFAULT_DIALOG_CONFIG,
        useValue: { ...new DialogConfig(), closeOnNavigation: false },
      },
      Dialog,
      BrnDialogService,
    ],
    inject(EnvironmentInjector),
  );
  private readonly dialogs = this.scope.get(BrnDialogService);
  private readonly positions = inject(OverlayPositionBuilder);
  private readonly document = inject(DOCUMENT);
  private readonly window = this.document.defaultView;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.scope.destroy());
  }

  open<R = never, D = undefined>(
    source: OverlaySource,
    options: OverlayOptions<D>,
  ): Promise<OverlayResult<R>> {
    if (options.signal?.aborted) return Promise.resolve('cancelled');
    const opener = this.document.activeElement;
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
    options.signal?.addEventListener('abort', () => ref.close(), {
      once: true,
    });
    // Handed a task after the close: the router replays the address of a
    // step back over a task's entry a task after the popstate, and a
    // navigation the opener starts on the result (sign-in going to a landing)
    // must come after that replay, or the replay undoes it.
    // The CDK gives the focus back to the opener only while the opener is
    // still on the page; when it has gone (a re-rendered row, the sign-in
    // sheet a 401 opened over nothing focused) the focus would fall to the
    // body with the closed panel, so it goes to the main content instead.
    // Focus the person already moved elsewhere stays where it is.
    return firstValueFrom(ref.closed$, { defaultValue: undefined }).then(
      (result) => {
        if (!this.stays(opener) && this.lost()) focusMain(this.document);
        return new Promise<OverlayResult<R>>((resolve) =>
          setTimeout(() => resolve(result ?? 'cancelled')),
        );
      },
    );
  }

  // True when the focus is nowhere, or still inside a pane that closed
  // (the kit marks it data-state="closed") and is leaving the page.
  private lost(): boolean {
    const active = this.document.activeElement;
    return (
      !active ||
      active === this.document.body ||
      !active.isConnected ||
      !!active.closest('.cdk-overlay-pane[data-state="closed"]')
    );
  }

  private stays(element: Element | null): boolean {
    return !!element && element !== this.document.body && element.isConnected;
  }
}
