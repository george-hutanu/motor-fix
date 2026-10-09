import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { PublicGarageDto, RequestDto } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { Session } from '../../../dashboard/session';
import type {
  RequestQuoteData,
  RequestQuoteResult,
} from '../request-quote/request-quote';
import { sentLine } from '../request-quote/sent-line';

// The profile's "Cere ofertă": opens the request dialog for the garage and,
// once a request went, says where. A visitor or a driver sees it; a garage-side
// role does not.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, RouterLink, TranslatePipe],
  selector: 'mf-request-quote-button',
  styleUrl: './request-quote-button.css',
  templateUrl: './request-quote-button.html',
})
export class RequestQuoteButton {
  readonly garage = input.required<PublicGarageDto>();
  private readonly overlays = inject(Overlays);
  private readonly session = inject(Session);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly i18n = inject(I18n);

  protected readonly sent = signal<RequestDto | null>(null);
  protected readonly shown = computed(() => {
    const role = this.session.current()?.role;
    return role === undefined || role === 'driver';
  });
  // The brand of the page, when the garage does not take it.
  protected readonly refusedBrand = computed(() => {
    const brand = this.garage().brand;
    return brand && brand.stance !== 'works_on' ? brand.name : null;
  });
  protected readonly line = computed(() => {
    const request = this.sent();
    return request ? sentLine(this.i18n, request) : '';
  });

  constructor() {
    // Nothing else on a public profile asks who is signed in: without this a
    // garage account that opens the profile by its address would see the
    // button. The server renders it for a visitor. The address names the
    // page's language, so the account's does not replace it.
    if (isPlatformBrowser(inject(PLATFORM_ID)))
      void this.session.load({ keepLanguage: true });
  }

  protected async open() {
    const source =
      this.route.snapshot.queryParamMap.get('src') === 'share'
        ? 'shared_link'
        : 'profile_direct';
    // Loaded on the first tap: the dialog stays out of the page's bundle.
    const { RequestQuote } = await import('../request-quote/request-quote');
    const result = await this.overlays.open<
      RequestQuoteResult,
      RequestQuoteData
    >(RequestQuote, {
      data: {
        garage: this.garage(),
        sent: (request) => this.sent.set(request),
        source,
      },
      shape: 'dialog',
      title: 'public.requestQuote.title',
    });
    // Resolved after the close's step back, so this navigation stays.
    if (typeof result === 'object' && 'go' in result)
      await this.router.navigateByUrl(result.go);
  }
}
