import { Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { type Navigation, Router } from '@angular/router';
import { TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { GarageRequestRow } from '../garage-request-row/garage-request-row';
import { GarageRequestsFeed } from '../garage-requests-feed';
import { GarageRequestsPanel } from '../garage-requests-panel/garage-requests-panel';
import { moreRows } from '../more-rows/more-rows';
import { QuotesSentPanel } from '../quotes-sent-panel/quotes-sent-panel';
import {
  RequestDrawer,
  type RequestDrawerData,
  type RequestDrawerResult,
} from '../request-drawer/request-drawer';

// The view's own address in views.ts, and a request's under it.
const VIEW = '/app/garage/requests';
const ADDRESS = /^\/app\/garage\/requests\/([^/?#]+)/;

// "Cereri de ofertă": every waiting request, 20 more each time the list's end
// comes into view, then those the driver closed in the last day, greyed; under
// them the quotes sent that still wait for the driver. A request's own
// address, /app/garage/requests/<id>, opens it in a drawer over the view;
// closing the drawer returns to where it was opened from.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    GarageRequestRow,
    GarageRequestsPanel,
    QuotesSentPanel,
    TranslatePipe,
  ],
  selector: 'mf-garage-requests-view',
  styleUrl: './garage-requests-view.css',
  templateUrl: './garage-requests-view.html',
})
export class GarageRequestsView {
  protected readonly feed = inject(GarageRequestsFeed);
  private readonly end = viewChild<ElementRef<HTMLElement>>('end');
  protected readonly more = moreRows(
    this.feed.rows,
    this.feed.nextCursor,
    (cursor) => this.feed.page(cursor),
    this.end,
  );
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly overlays = inject(Overlays);
  private shown: string | null = null;

  constructor() {
    effect(() => {
      const navigation = this.router.lastSuccessfulNavigation();
      untracked(() => {
        if (navigation) void this.follow(navigation);
      });
    });
  }

  private async follow(navigation: Navigation) {
    const address = this.router.url;
    const id = ADDRESS.exec(address)?.[1];
    if (!id || this.shown) return;
    this.shown = id;
    const origin = navigation.extras.state?.['origin'];
    const result = await this.overlays.open<
      RequestDrawerResult,
      RequestDrawerData
    >(RequestDrawer, {
      data: { id },
      shape: 'drawer',
      title: 'garage.requests.detail.title',
    });
    this.shown = null;
    if (result === 'sent') this.feed.sent(id);
    else if (result === 'declined' || result === 'refused') this.feed.reload();
    // Leaving the address some other way already took the person elsewhere;
    // another request's address reached while this one was open opens now.
    if (this.router.url !== address) {
      const next = this.router.lastSuccessfulNavigation();
      if (next) void this.follow(next);
      return;
    }
    this.leave(id, origin, result);
  }

  // Opened in the app, the origin is the entry before: going back to it
  // leaves no second one. Opened by its address, the view replaces it.
  private leave(id: string, origin: unknown, result: string) {
    if (typeof origin !== 'string') {
      void this.router.navigateByUrl(VIEW, { replaceUrl: true });
      return;
    }
    // The overlay gave the focus back to the view's row; another page is
    // drawn anew, so its row of this request takes it there.
    if (result === 'cancelled' && origin !== VIEW) this.feed.returnFocusTo(id);
    this.location.back();
  }
}
