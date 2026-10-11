import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import type { EventKind } from '@motor-fix/contracts';
import { GARAGE_CLOSE_REASONS } from '@motor-fix/contracts/request-status';
import { GarageRequestsService } from '@motor-fix/data-access';
import {
  I18n,
  requestAge,
  requestExpiry,
  TranslatePipe,
} from '@motor-fix/i18n';
import {
  injectOverlayTask,
  type OverlayResult,
  Overlays,
} from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { Live, liveResource } from '../../live';
import type { DeclineRequestResult } from '../decline-request-dialog/decline-request-dialog';
import { declineRequest, sendQuote } from '../request-actions';
import type { SendQuoteResult } from '../send-quote-dialog/send-quote-dialog';

export interface RequestDrawerData {
  id: string;
}

// Answered from the drawer, or refused because it was answered or closed
// meanwhile: the opener re-reads its lists.
export type RequestDrawerResult = 'sent' | 'declined' | 'refused';

// The events that may close the request while it is open. Each names its own
// subject (the recipient row, the new quote), not this request, so any of
// them in the garage's stream re-reads it.
const CLOSING: readonly EventKind[] = [
  'quote.sent',
  'request.declined',
  'request.cancelled',
  'request.expired',
  'quote.accepted',
];
const DETAIL = 'garage.requests.detail';
// The colleague's quote has no close reason of its own, only its own banner.
const REASONS = new Set<string>([...GARAGE_CLOSE_REASONS, 'quoted']);
// The read's refusals that leave nothing to show and nothing to try again.
const REFUSED = new Set([400, 403]);

// "Cerere de ofertă": the whole request as the garage reads it before it
// answers — the customer, the car, every job, the description as written,
// the times — with Trimite oferta and Refuză under it. A request that closes
// while it is open says why and keeps what it showed.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-request-drawer',
  styleUrl: './request-drawer.css',
  templateUrl: './request-drawer.html',
})
export class RequestDrawer {
  private readonly api = inject(GarageRequestsService);
  private readonly overlays = inject(Overlays);
  private readonly language = inject(I18n).language;
  protected readonly offline = inject(Live).offline;
  private readonly task = injectOverlayTask<
    RequestDrawerData,
    RequestDrawerResult
  >();
  private readonly id = this.task.data.id;

  protected readonly view = liveResource(
    () => this.api.garageRequestsControllerGet({ id: this.id }),
    CLOSING,
  );
  protected readonly request = computed(() => this.view.value());

  protected readonly refusal = computed(() => {
    if (this.view.gone()) return `${DETAIL}.notFound`;
    const error = this.view.error();
    if (!(error instanceof HttpErrorResponse) || !REFUSED.has(error.status))
      return null;
    return `${DETAIL}.${error.status === 403 ? 'forbidden' : 'notFound'}`;
  });

  protected readonly car = computed(() => {
    const car = this.request()?.car;
    return car ? { ...car, fuel: `${DETAIL}.fuel.${car.fuel}` } : null;
  });

  protected readonly jobs = computed(() => {
    const english = this.language() === 'en';
    const named = (this.request()?.jobs ?? []).map((job) => ({
      id: job.id,
      name: english ? job.nameEn : job.nameRo,
      offered: job.offered,
    }));
    return {
      apart: named.filter((job) => !job.offered),
      done: named.filter((job) => job.offered),
    };
  });

  protected readonly description = computed(() => {
    const text = this.request()?.description;
    return text?.trim() ? text : null;
  });

  protected readonly received = computed(() => {
    const request = this.request();
    return request
      ? requestAge(request.createdAt, this.language(), new Date())
      : '';
  });
  protected readonly expiry = computed(() => {
    const request = this.request();
    return request
      ? requestExpiry(request.expiresAt, this.language(), new Date())
      : '';
  });

  // Why it closed, as the banner says it; none while it waits, and none once
  // this garage's own quote is accepted.
  protected readonly closed = computed(() => {
    const request = this.request();
    if (!request || request.quote?.status === 'accepted') return null;
    const reason =
      request.recipient.status === 'quoted'
        ? 'quoted'
        : request.closedReason ||
          (request.recipient.status === 'waiting' ? null : 'unknown');
    if (!reason) return null;
    return `${DETAIL}.closed.${REASONS.has(reason) ? reason : 'unknown'}`;
  });

  protected readonly disabled = computed(() => {
    const request = this.request();
    return (
      !request ||
      this.offline() ||
      this.closed() !== null ||
      request.quote?.status === 'accepted'
    );
  });

  protected async send() {
    this.finish(await sendQuote(this.overlays, null, this.id));
  }

  protected async decline() {
    const request = this.request();
    if (request)
      this.finish(await declineRequest(this.overlays, null, request));
  }

  private finish(
    result: OverlayResult<SendQuoteResult | DeclineRequestResult>,
  ) {
    if (result === 'sent' || result === 'declined' || result === 'refused')
      this.task.close(result);
  }
}
