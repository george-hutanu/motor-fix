import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type {
  MeDto,
  PublicGarageDto,
  RequestDto,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { Consent } from '../../../consent/consent';
import { confirmRoleHint, Session } from '../../../dashboard/session';
import type {
  RequestQuoteData,
  RequestQuoteResult,
} from '../request-quote/request-quote';
import { sentLine } from '../request-quote/sent-line';

// A visitor or a driver may ask a garage for a quote; a garage-side role not.
export const canRequest = (role: MeDto['role'] | null) =>
  role === null || role === 'driver';

// The profile's "Cere ofertă": opens the request dialog for the garage and,
// once a request went, says where. A visitor or a driver sees it; a garage-side
// role does not. The estimate box hands it the jobs switched on and its own
// text, and says the sent line in its own live region; the header hands it
// none, the dialog starts empty, and the sent line is a status of its own.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, RouterLink, TranslatePipe],
  selector: 'mf-request-quote-button',
  styleUrl: './request-quote-button.css',
  templateUrl: './request-quote-button.html',
})
export class RequestQuoteButton {
  readonly garage = input.required<PublicGarageDto>();
  readonly jobs = input<readonly string[]>();
  readonly textKey = input('public.requestQuote.button');
  readonly announce = input(true);
  readonly said = output<string>();
  // Tells two buttons with the same text apart, the box's and the bar's.
  readonly place = input('');
  // Named after the text and the place, which tell the buttons apart, so the
  // server and the browser give the note the same id.
  protected readonly noteId = computed(() => {
    const place = this.place();
    return `mf-quote-refused-${this.textKey().replaceAll('.', '-')}${place ? `-${place}` : ''}`;
  });
  private readonly overlays = inject(Overlays);
  private readonly session = inject(Session);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly consent = inject(Consent);
  protected readonly i18n = inject(I18n);

  protected readonly sent = signal<RequestDto | null>(null);
  // A public page asks nobody who is signed in: without a session loaded, the
  // role this browser last saw decides, so a garage account that opens the
  // profile by its address does not see the button.
  protected readonly shown = computed(() =>
    canRequest(this.session.current()?.role ?? this.session.roleHint()),
  );
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
    confirmRoleHint(this.session);
  }

  protected async open() {
    const jobs = this.jobs();
    this.consent.track('quote_request_started', { source: 'profile' });
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
        ...(jobs === undefined ? {} : { jobTypeIds: [...jobs] }),
        sent: (request) => {
          this.sent.set(request);
          this.said.emit(this.line());
        },
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
