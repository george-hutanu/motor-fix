import { isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  Injector,
  inject,
  linkedSignal,
  PLATFORM_ID,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { REQUEST_STATUS_LABELS } from '@motor-fix/contracts/request-status';
import {
  type RequestSummaryDto,
  RequestsService,
} from '@motor-fix/data-access';
import {
  formatSlot,
  I18n,
  relativeTime,
  TranslatePipe,
  timeLeft,
} from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton, Panel } from '@motor-fix/ui-cockpit';

import {
  type CancelBookingData,
  CancelBookingDialog,
  type CancelBookingResult,
} from './cancel-booking-dialog/cancel-booking-dialog';
import {
  type CancelRequestData,
  CancelRequestDialog,
  type CancelRequestResult,
} from './cancel-request-dialog/cancel-request-dialog';
import { ActiveRequest } from '../active-request/active-request';
import { EmptyState } from '../empty-state/empty-state';
import { focusCard } from '../focus-card';
import { liveResource, REQUEST_EVENTS } from '../live';
import { openRequestOf } from '../quotes-compare/compare-rules/compare-rules';
import { QuotesCompare } from '../quotes-compare/quotes-compare';

interface Row {
  id: string;
  car: string;
  what: string;
  status: string;
  when: string;
  // Set while the booking waits for the garage: the time it has left.
  waiting?: string;
  // Set once the garage confirmed: the slot, with its instant.
  booked?: { at: string; slot: string };
  // The garage let the booking lapse and another quote is still open.
  lapsed?: true;
  quoted: boolean;
  // The one cancel the row offers, if any: the request before a booking
  // holds it, the booking while it is ahead and its job has not started.
  cancel?: { kind: 'request' } | ({ kind: 'booking' } & CancelBookingData);
  // The driver cancelled it: "Anulată de tine", late when it was.
  cancelledByYou?: { late: boolean };
  // The driver cancelled the booking and the request takes quotes again.
  reopened?: true;
}

const TICK_MS = 60_000;

// "Cererile mele": the driver's requests, newest first, kept current by the
// request events so one sent in another tab shows up without a reload. A
// booked request waiting for the garage counts down its time to confirm,
// then names its slot once confirmed, or asks for another quote after a
// lapse. The active request's panel heads a list with rows.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ActiveRequest,
    EmptyState,
    HlmButton,
    Panel,
    QuotesCompare,
    RouterLink,
    TranslatePipe,
  ],
  selector: 'mf-requests-view',
  styleUrl: './requests-view.css',
  templateUrl: './requests-view.html',
})
export class RequestsView {
  private readonly api = inject(RequestsService);
  private readonly i18n = inject(I18n);
  private readonly overlays = inject(Overlays);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  // A cancel dialog is up: the row actions open no second one.
  private cancelling = false;
  protected readonly language = this.i18n.language;
  protected readonly list = liveResource(
    () => this.api.requestsControllerList(),
    REQUEST_EVENTS,
  );
  // The active request's panel above the list, moved by the same events.
  private readonly activeRead = liveResource(
    () => this.api.activeRequestControllerGet(),
    REQUEST_EVENTS,
  );
  protected readonly active = computed(() =>
    this.activeRead.failed() && !this.activeRead.value()
      ? 'failed'
      : this.activeRead.value(),
  );
  protected retryActive() {
    this.activeRead.reload();
  }
  // Sampled again on every read of the list, so a line read right after an
  // acceptance measures from then; the tick moves it between reads.
  private readonly now = linkedSignal({
    computation: () => new Date(),
    source: () => this.list.value(),
  });
  protected readonly rows = computed(() => {
    const items = this.list.value()?.items;
    if (!items) return undefined;
    const language = this.language();
    const now = this.now();
    return items.map((item) => this.row(item, language, now));
  });

  private readonly query = toSignal(inject(ActivatedRoute).queryParamMap);
  // The default request: the newest still open, picked once and kept while
  // it is listed, so a live re-read never moves the panel.
  private readonly fallback = linkedSignal<
    readonly RequestSummaryDto[],
    string | undefined
  >({
    computation: (items, previous) =>
      previous?.value && items.some((i) => i.id === previous.value)
        ? previous.value
        : openRequestOf(items)?.id,
    source: () => this.list.value()?.items ?? [],
  });
  // The request whose quotes are compared above the list: the one the
  // address names when it is the driver's and has quotes, else the default.
  // A list of one, so another request makes a new panel.
  protected readonly compared = computed(() => {
    const items = this.list.value()?.items ?? [];
    const asked = this.query()?.get('request');
    const named = items.find((i) => i.id === asked && i.quotesCount > 0);
    const shown = named?.id ?? this.fallback();
    return shown ? [shown] : [];
  });

  constructor() {
    void this.i18n.enter('driver');
    focusCard('data-request', this.rows);
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const tick = setInterval(() => this.now.set(new Date()), TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
  }

  // Opens the row's cancel, re-reads the list after a cancel or a refusal,
  // then gives the focus back to the row's action, or to the row when the
  // action is gone.
  protected async cancel(row: Row) {
    const offer = row.cancel;
    if (!offer || this.cancelling) return;
    this.cancelling = true;
    const result = await this.ask(row, offer).finally(() => {
      this.cancelling = false;
    });
    if (result === 'done' || result === 'refused') await this.list.reload();
    afterNextRender(
      () => {
        const card = Array.from(
          this.host.nativeElement.querySelectorAll<HTMLElement>(
            '[data-request]',
          ),
        ).find((el) => el.getAttribute('data-request') === row.id);
        const action = card?.querySelector<HTMLElement>('.actions .cancel');
        (action ?? card)?.focus();
      },
      { injector: this.injector },
    );
  }

  private ask(row: Row, offer: NonNullable<Row['cancel']>) {
    return offer.kind === 'booking'
      ? this.overlays.open<CancelBookingResult, CancelBookingData>(
          CancelBookingDialog,
          {
            data: {
              bookingId: offer.bookingId,
              garage: offer.garage,
              startsAt: offer.startsAt,
            },
            shape: 'dialog',
            title: 'driver.requests.cancelBookingDialog.title',
          },
        )
      : this.overlays.open<CancelRequestResult, CancelRequestData>(
          CancelRequestDialog,
          {
            data: { car: row.car, requestId: row.id, what: row.what },
            shape: 'dialog',
            title: 'driver.requests.cancelRequestDialog.title',
          },
        );
  }

  private row(item: RequestSummaryDto, language: 'ro' | 'en', now: Date): Row {
    const { brand, model, year } = item.car;
    const booking = item.booking;
    const jobs = item.jobs.map((job) =>
      language === 'en' ? job.nameEn : job.nameRo,
    );
    return {
      car: `${brand} ${model} ${year}`,
      id: item.id,
      quoted: item.quotesCount > 0,
      status: REQUEST_STATUS_LABELS[language][item.status],
      what: jobs.length
        ? jobs.join(', ')
        : (item.description ?? '').split('\n')[0],
      when: relativeTime(item.createdAt, language, now),
      ...(item.status === 'booked' &&
        booking?.status === 'awaiting_confirmation' && {
          waiting: timeLeft(booking.confirmBy, language, now),
        }),
      ...(item.status === 'booked' &&
        booking?.status === 'confirmed' && {
          booked: {
            at: booking.startsAt,
            slot: formatSlot(booking.startsAt, language, now),
          },
        }),
      ...(item.status === 'quoted' &&
        booking?.status === 'lapsed' && { lapsed: true as const }),
      ...cancelOf(item, now),
      ...(byDriver(item) && {
        cancelledByYou: {
          late:
            item.closedReason === 'booking_cancelled' &&
            item.booking?.lateCancellation === true,
        },
      }),
      ...(item.status === 'quoted' &&
        booking?.status === 'cancelled' &&
        booking.cancelledBySide === 'driver' && { reopened: true as const }),
    };
  }
}

// The cancel a request offers now: the request while it is sent or
// quoted; the booking while it waits or is confirmed, starts after now and
// its job has not started; nothing otherwise.
function cancelOf(item: RequestSummaryDto, now: Date): Pick<Row, 'cancel'> {
  if (item.status === 'sent' || item.status === 'quoted')
    return { cancel: { kind: 'request' } };
  const booking = item.booking;
  if (
    item.status !== 'booked' ||
    !booking ||
    (booking.status !== 'awaiting_confirmation' &&
      booking.status !== 'confirmed') ||
    booking.jobStarted ||
    // An unreadable start (NaN) is not ahead of now either.
    !(new Date(booking.startsAt).getTime() > now.getTime())
  )
    return {};
  return {
    cancel: {
      bookingId: booking.id,
      garage: booking.garage.name,
      kind: 'booking',
      startsAt: booking.startsAt,
    },
  };
}

// A request closed by the driver's own cancel, of the request or of its
// booking.
function byDriver(item: RequestSummaryDto): boolean {
  if (item.status !== 'closed') return false;
  if (item.closedReason === 'cancelled') return true;
  return (
    item.closedReason === 'booking_cancelled' &&
    item.booking?.cancelledBySide === 'driver'
  );
}
