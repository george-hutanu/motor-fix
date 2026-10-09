import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { PublicGarageDto, RequestDto } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { Session } from '../../../dashboard/session';
import type { RequestQuoteData } from '../request-quote/request-quote';

// "Trimis către Service Auto Militari." or "Trimis către 3 service-uri."
export function sentLine(i18n: I18n, request: RequestDto) {
  const names = request.recipients.map((r) => r.garage.name);
  return names.length === 1
    ? i18n.t('public.requestQuote.sentOne', { garage: names[0] })
    : i18n.t('public.requestQuote.sentMany', { count: names.length });
}

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

  protected async open() {
    const source =
      this.route.snapshot.queryParamMap.get('src') === 'share'
        ? 'shared_link'
        : 'profile_direct';
    // Loaded on the first tap: the dialog stays out of the page's bundle.
    const { RequestQuote } = await import('../request-quote/request-quote');
    await this.overlays.open<RequestDto, RequestQuoteData>(RequestQuote, {
      data: {
        garage: this.garage(),
        sent: (request) => this.sent.set(request),
        source,
      },
      shape: 'dialog',
      title: 'public.requestQuote.title',
    });
  }
}
