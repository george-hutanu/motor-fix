import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  PendingTasks,
  RESPONSE_INIT,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { CarsService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { toProblem } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { publicRead } from '../../public-read';

type State =
  | 'loading'
  | 'valid'
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

// The line a refused read shows: the seller opening their own link sees it
// holds; an ended link names how it ended.
function refused(code: string, status: number): State {
  if (code === 'own_transfer') return 'valid';
  if (status === 404) return 'unknown';
  if (status === 410) return ENDED[code] ?? 'cancelled';
  return 'failed';
}

// The buyer's link from the sale dialog, opened by anyone: one line saying
// whether the link still holds. It shows nothing the answer carries (car,
// seller, repairs), is never indexed (its route's `noindex`), and an unknown
// or ended link is served 404 or 410.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-transfer',
  styleUrl: './transfer.css',
  templateUrl: './transfer.html',
})
export class TransferPage {
  private readonly cars = inject(CarsService);
  private readonly pending = inject(PendingTasks);
  private readonly response = inject(RESPONSE_INIT, { optional: true });
  private readonly route = inject(ActivatedRoute);
  private readonly i18n = inject(I18n);
  protected readonly state = signal<State>('loading');
  protected readonly line = computed(() => `public.transfer.${this.state()}`);

  constructor() {
    const title = inject(Title);
    effect(() => title.setTitle(this.i18n.t(this.line())));
    // A link opened from another link reuses the page: each token is read.
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(() => {
      void this.read();
    });
  }

  protected async read() {
    this.state.set('loading');
    const done = this.pending.add();
    try {
      await this.cars.carTransferLinkControllerRead(
        { token: this.route.snapshot.paramMap.get('token') ?? '' },
        publicRead(),
      );
      this.state.set('valid');
    } catch (error) {
      const { code, status } = toProblem(error);
      const state = refused(code, status);
      this.state.set(state);
      if (this.response && (status === 404 || status === 410))
        this.response.status = status;
    } finally {
      done();
    }
  }
}
