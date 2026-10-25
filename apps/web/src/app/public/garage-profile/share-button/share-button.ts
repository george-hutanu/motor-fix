import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  Injector,
  inject,
  input,
  linkedSignal,
  viewChild,
} from '@angular/core';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { toast } from '@motor-fix/ui-cockpit';

import { SITE_ORIGIN } from '../../../addresses';

let fields = 0;

// The profile's "Distribuie": the phone's share menu with the garage's own
// address, else a copy of it, else the address shown selected to copy by hand.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  selector: 'mf-share-button',
  styleUrl: './share-button.css',
  templateUrl: './share-button.html',
})
export class ShareButton {
  readonly name = input.required<string>();
  readonly slug = input.required<string>();
  readonly brand = input<string>();
  protected readonly i18n = inject(I18n);
  private readonly origin = inject(SITE_ORIGIN).replace(/\/+$/, '');
  private readonly injector = inject(Injector);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');
  protected readonly fieldId = `mf-share-${++fields}`;

  // The origin the canonical link is written with, and only the brand and
  // the share marker: nothing else of the address the page was opened with.
  protected readonly address = computed(() => {
    const brand = this.brand();
    const query = brand ? `brand=${encodeURIComponent(brand)}&` : '';
    return `${this.origin}/${this.i18n.language()}/garages/${encodeURIComponent(this.slug())}?${query}src=share`;
  });
  // Shown once a copy is refused, until the page shows another garage.
  protected readonly manual = linkedSignal({
    computation: () => false,
    source: () => [this.slug(), this.brand()],
  });

  protected async share() {
    const url = this.address();
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: this.name(), url });
        return;
      } catch (failure) {
        if ((failure as { name?: unknown } | null)?.name === 'AbortError')
          return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast(this.i18n.t('public.garageProfile.shareCopied'));
    } catch {
      this.manual.set(true);
      afterNextRender(
        () => {
          const field = this.field()?.nativeElement;
          field?.focus();
          field?.select();
        },
        { injector: this.injector },
      );
    }
  }
}
