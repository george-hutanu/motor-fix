import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import type { PublicGarageDto } from '@motor-fix/data-access';
import {
  formatNum,
  formatWholeLeiRange,
  I18n,
  TranslatePipe,
} from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { Session } from '../../../dashboard/session';
import { takesText } from '../../tab-bar/tab-bar';
import {
  EstimateSheet,
  type EstimateSheetData,
} from '../estimate-sheet/estimate-sheet';
import { PriceSelection } from '../price-selection/price-selection';
import { estimateTotals } from '../price-selection/totals';
import {
  canRequest,
  RequestQuoteButton,
} from '../request-quote-button/request-quote-button';

// A phone's estimate and "Cere ofertă", pinned on the tab bar below 768 px:
// the total opens the whole box in a sheet. It is hidden while the keyboard
// is up and for a garage-side role, and gives the page its height as
// --estimate-bar, 0 while hidden.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:focusin)': 'typing.set(takesText($event.target))',
    '(document:focusout)': 'typing.set(false)',
    '[hidden]': 'typing() || !shown()',
  },
  imports: [RequestQuoteButton, TranslatePipe],
  selector: 'mf-estimate-bar',
  styleUrl: './estimate-bar.css',
  templateUrl: './estimate-bar.html',
})
export class EstimateBar {
  readonly garage = input.required<PublicGarageDto>();

  private readonly i18n = inject(I18n);
  private readonly overlays = inject(Overlays);
  private readonly session = inject(Session);
  protected readonly selection = inject(PriceSelection);

  protected readonly typing = signal(false);
  protected readonly takesText = takesText;
  protected readonly shown = computed(() =>
    canRequest(this.session.current()?.role ?? this.session.roleHint()),
  );
  private readonly totals = computed(() =>
    estimateTotals(this.garage().prices, this.selection.on()),
  );
  protected readonly jobs = computed(() =>
    this.totals().chosen.map((row) => row.jobTypeId),
  );
  protected readonly range = computed(() => {
    const { fromLei, toLei } = this.totals();
    return formatWholeLeiRange(
      fromLei * 100,
      toLei * 100,
      this.i18n.language(),
    );
  });
  protected readonly spoken = computed(() => {
    const { fromLei, toLei } = this.totals();
    const language = this.i18n.language();
    return this.i18n.t('public.garageProfile.estimate.spoken', {
      from: formatNum(fromLei, language),
      to: formatNum(toLei, language),
    });
  });

  constructor() {
    if (
      !isPlatformBrowser(inject(PLATFORM_ID)) ||
      typeof ResizeObserver === 'undefined'
    )
      return;
    const root = inject(DOCUMENT).documentElement;
    const observer = new ResizeObserver(([entry]) =>
      root.style.setProperty(
        '--estimate-bar',
        `${Math.ceil(entry?.contentRect.height ?? 0)}px`,
      ),
    );
    observer.observe(inject(ElementRef).nativeElement);
    inject(DestroyRef).onDestroy(() => {
      observer.disconnect();
      root.style.removeProperty('--estimate-bar');
    });
  }

  protected open() {
    void this.overlays.open<never, EstimateSheetData>(EstimateSheet, {
      data: { garage: this.garage, selection: this.selection },
      shape: 'dialog',
      title: 'public.garageProfile.estimate.title',
    });
  }
}
