import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { GaragesService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton, toast } from '@motor-fix/ui-cockpit';

import { Consent } from '../../../consent/consent';
import { httpStatus } from '../../../http-status';
import type {
  RequestQuoteData,
  RequestQuoteResult,
} from '../../../public/garage-profile/request-quote/request-quote';
import { publicRead } from '../../../public-read';
import { Voice } from '../../../voice/voice';

const GONE = [404, 410];

// A saved row's "Cere ofertă": reads the garage's public profile, then opens
// the profile's own request dialog for it with the source `saved`. A garage
// gone since it was saved leaves "Indisponibil" in the button's place.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-request-saved-quote',
  templateUrl: './request-saved-quote.html',
})
export class RequestSavedQuote {
  readonly slug = input.required<string>();
  readonly name = input.required<string>();

  private readonly garages = inject(GaragesService);
  private readonly overlays = inject(Overlays);
  private readonly router = inject(Router);
  private readonly consent = inject(Consent);
  private readonly voice = inject(Voice);
  private readonly i18n = inject(I18n);

  protected readonly state = signal<'idle' | 'pending' | 'unavailable'>('idle');

  protected async open() {
    if (this.state() !== 'idle') return;
    this.state.set('pending');
    this.consent.track('quote_request_started', {
      source: 'saved',
      voice: this.voice.voice,
    });
    let garage: RequestQuoteData['garage'];
    try {
      garage = await this.garages.publicGaragesControllerBySlug(
        { slug: this.slug() },
        publicRead(),
      );
    } catch (error) {
      const status = httpStatus(error);
      if (GONE.includes(status)) {
        this.state.set('unavailable');
        return;
      }
      this.state.set('idle');
      toast(
        this.i18n.t(
          status === 0
            ? 'public.saveGarage.noConnection'
            : 'public.saveGarage.failed',
        ),
      );
      return;
    }
    this.state.set('idle');
    // Loaded on the first tap: the dialog stays out of the list's bundle.
    const { RequestQuote } = await import(
      '../../../public/garage-profile/request-quote/request-quote'
    );
    const result = await this.overlays.open<
      RequestQuoteResult,
      RequestQuoteData
    >(RequestQuote, {
      data: { garage, source: 'saved' },
      shape: 'dialog',
      title: 'public.requestQuote.title',
    });
    if (typeof result === 'object' && 'go' in result)
      await this.router.navigateByUrl(result.go);
  }
}
