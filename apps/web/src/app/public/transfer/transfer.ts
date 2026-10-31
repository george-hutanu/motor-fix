import { DOCUMENT } from '@angular/common';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  effect,
  inject,
  PendingTasks,
  RESPONSE_INIT,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import {
  CarsService,
  type CarTransferLinkDto,
  type MeDto,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { toProblem } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { Consent } from '../../consent/consent';
import { Session } from '../../dashboard/session';
import { publicRead } from '../../public-read';
import { SignInDialog } from '../../sign-in/sign-in-dialog';

type State =
  | 'loading'
  | 'waiting'
  | 'offer'
  | 'own'
  | 'car_limit'
  | 'open_request'
  | 'unknown'
  | 'cancelled'
  | 'expired'
  | 'accepted'
  | 'failed';

// The API's refusals of a link, and the line each one reads as.
const ENDED: Record<string, State> = {
  transfer_accepted: 'accepted',
  transfer_cancelled: 'cancelled',
  transfer_expired: 'expired',
};

// The line a refused read shows: the seller opening their own link is told
// they cannot take it over; an ended link names how it ended.
function refused(code: string, status: number): State {
  if (code === 'own_transfer') return 'own';
  if (status === 404) return 'unknown';
  if (status === 410) return ENDED[code] ?? 'cancelled';
  return 'failed';
}

// The states whose heading is the car's line.
const WITH_CAR = new Set<State>(['offer', 'car_limit', 'open_request']);

// The buyer's link from the sale dialog. A visitor reads only that a car is
// waiting and is asked to sign in; a signed-in buyer reads the car, how many
// repairs pass on and from whom, and takes it over. It is never indexed (its
// route's `noindex`), and an unknown or ended link is served 404 or 410.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-transfer',
  styleUrl: './transfer.css',
  templateUrl: './transfer.html',
})
export class TransferPage {
  private readonly cars = inject(CarsService);
  private readonly consent = inject(Consent);
  private readonly pending = inject(PendingTasks);
  private readonly response = inject(RESPONSE_INIT, { optional: true });
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly session = inject(Session);
  private readonly signInDialog = inject(SignInDialog);
  private readonly i18n = inject(I18n);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  protected readonly state = signal<State>('loading');
  private readonly offer = signal<CarTransferLinkDto | undefined>(undefined);
  protected readonly accepting = signal(false);
  protected readonly acceptFailed = signal(false);
  protected readonly line = computed(() => {
    const state = this.state();
    const offer = this.offer();
    if (!WITH_CAR.has(state) || !offer?.car) return this.text(state);
    const { brand, model, year } = offer.car;
    const count = offer.repairCount ?? 0;
    const repairs = count
      ? this.i18n.t('public.transfer.repairs', { count })
      : this.i18n.t('public.transfer.repairs.none');
    const from = offer.sellerName
      ? ` · ${this.i18n.t('public.transfer.from', { name: offer.sellerName })}`
      : '';
    return `${brand} ${model} ${year} · ${repairs}${from}`;
  });

  // Which session the last read went with: a sign-in elsewhere on the page
  // reads the link again; the page's own reads are not repeated.
  private readFor: MeDto | null = null;
  private reads = 0;
  private asking = false;
  // An action replaced the control that held focus: the heading takes it.
  private refocus = false;

  constructor() {
    const title = inject(Title);
    effect(() => title.setTitle(this.line()));
    // A link opened from another link reuses the page: each token is read.
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(() => {
      void this.read();
    });
    effect(() => {
      const me = this.session.current();
      untracked(() => {
        if (me && me !== this.readFor && this.state() === 'waiting')
          void this.read();
      });
    });
    const document = inject(DOCUMENT);
    afterRenderEffect(() => {
      const state = this.state();
      if (!this.refocus || state === 'loading' || this.accepting()) return;
      this.refocus = false;
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      this.heading()?.nativeElement.focus();
    });
  }

  private text(state: State) {
    return this.i18n.t(`public.transfer.${state}`);
  }

  private get token() {
    return this.route.snapshot.paramMap.get('token') ?? '';
  }

  protected async read() {
    const me = this.session.current();
    this.readFor = me;
    const read = ++this.reads;
    this.state.set('loading');
    this.acceptFailed.set(false);
    const done = this.pending.add();
    try {
      // Without a session the read goes as a visitor's, so the server
      // render's answer is handed over; with one it carries the token.
      const answer = await this.cars.carTransferLinkControllerRead(
        { token: this.token },
        ...(me ? [] : [publicRead()]),
      );
      if (read !== this.reads) return;
      this.offer.set(answer);
      this.state.set(answer.car ? 'offer' : 'waiting');
    } catch (error) {
      if (read === this.reads) this.refusedRead(error);
    } finally {
      done();
    }
  }

  private refusedRead(error: unknown) {
    const { code, status } = toProblem(error);
    this.state.set(refused(code, status));
    if (this.response && (status === 404 || status === 410))
      this.response.status = status;
  }

  // "Intră în cont": a session already held reads at once; otherwise the
  // sign-in dialog, and a closed dialog leaves the line as it was.
  protected async signIn() {
    if (this.asking) return;
    this.asking = true;
    try {
      const me =
        (await this.session.load({ keepLanguage: true }).catch(() => null)) ??
        ((await this.signInDialog.gate()) ? this.session.current() : null);
      if (!me && !this.session.current()) return;
      this.refocus = true;
      await this.read();
    } finally {
      this.asking = false;
    }
  }

  // "Preiau mașina": one request; the car opens in Mașinile mele.
  protected async accept() {
    if (this.accepting()) return;
    this.accepting.set(true);
    this.acceptFailed.set(false);
    this.refocus = true;
    let carId: string;
    try {
      ({ carId } = await this.cars.carTransferLinkControllerAccept({
        token: this.token,
      }));
    } catch (error) {
      this.accepting.set(false);
      this.refusedAccept(error);
      return;
    }
    this.consent.track('car_taken_over');
    try {
      // The new car may be the account's first as a driver.
      await this.session.reload();
      const me = this.session.current();
      if (me && me.role !== 'driver') await this.session.switchRole('driver');
    } catch {
      // The car is taken over: its page reads the session on its own.
    }
    await this.router.navigateByUrl(`/app/driver/cars/${carId}`);
    this.accepting.set(false);
  }

  private refusedAccept(error: unknown) {
    const { code, status } = toProblem(error);
    if (status === 409 && (code === 'car_limit' || code === 'open_request'))
      this.state.set(code);
    // The sign-in the interceptor asked for was closed: the visitor's line.
    else if (status === 401) void this.read();
    else if (status === 403 || status === 404 || status === 410)
      this.state.set(refused(code, status));
    else this.acceptFailed.set(true);
  }
}
