import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import type { PublicGarageDto } from '@motor-fix/data-access';
import { TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { Session } from '../../../dashboard/session';
import { SignInDialog } from '../../../sign-in/sign-in-dialog';
import type { ReportGarageResult } from '../report-garage/report-garage';

// The profile's quiet "Raportează service-ul". A visitor or a driver sees it,
// as with "Cere ofertă"; a visitor signs in first, on the same page.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  selector: 'mf-report-garage-link',
  styleUrl: './report-garage-link.css',
  templateUrl: './report-garage-link.html',
})
export class ReportGarageLink {
  readonly garage = input.required<PublicGarageDto>();
  private readonly overlays = inject(Overlays);
  private readonly session = inject(Session);
  private readonly signIn = inject(SignInDialog);

  protected readonly outcome = signal<'sent' | 'hidden' | null>(null);
  private readonly role = computed(
    () => this.session.current()?.role ?? this.session.roleHint(),
  );
  protected readonly shown = computed(() => {
    const role = this.role();
    return this.outcome() === null && (role === null || role === 'driver');
  });

  protected async open() {
    // A page opened by its address has not loaded the session yet: someone
    // signed in is not asked to sign in again.
    if (!(await this.session.load()) && !(await this.signIn.gate())) return;
    if (this.session.current()?.role !== 'driver') {
      this.outcome.set('hidden');
      return;
    }
    // Loaded on the first tap: the task stays out of the page's bundle.
    const { ReportGarage } = await import('../report-garage/report-garage');
    const result = await this.overlays.open<
      ReportGarageResult,
      { garage: PublicGarageDto }
    >(ReportGarage, {
      data: { garage: this.garage() },
      shape: 'dialog',
      title: 'public.reportGarage.title',
    });
    if (result === 'sent') this.outcome.set('sent');
    if (result === 'gone') this.outcome.set('hidden');
  }
}
