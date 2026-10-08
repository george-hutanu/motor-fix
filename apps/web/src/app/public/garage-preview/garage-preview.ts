import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import type {
  DetailsSection,
  MechanicsSection,
  PricesSection,
} from '@motor-fix/contracts/listing-sections';
import { AsWritten, TranslatePipe } from '@motor-fix/i18n';
import { Lamp } from '@motor-fix/ui-cockpit';

import { previewCard } from './preview-card';
import { BrandVerdict } from '../brand-verdict';
import type { BrandsSection } from '../brands-section';

let panels = 0;

const end = (lei: number | null) => (lei === null ? '…' : String(lei));

// The garage as drivers will see it, drawn from the form as it is typed:
// beside the form on a wide screen, a collapsible panel above Save below.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AsWritten, BrandVerdict, Lamp, TranslatePipe],
  selector: 'mf-garage-preview',
  styleUrl: './garage-preview.css',
  templateUrl: './garage-preview.html',
})
export class GaragePreview {
  readonly details = input.required<DetailsSection>();
  readonly brands = input.required<BrandsSection>();
  readonly prices = input<PricesSection | undefined>(undefined);
  readonly mechanics = input.required<MechanicsSection>();
  readonly order = input.required<string[]>();

  protected readonly id = `garage-preview-${++panels}`;
  protected readonly open = signal(false);

  protected readonly card = computed(() =>
    previewCard({
      brands: this.brands(),
      details: this.details(),
      mechanics: this.mechanics(),
      order: this.order(),
      prices: this.prices(),
    }),
  );

  protected readonly range = computed(() => {
    const range = this.card().range;
    return range && { from: end(range.from), to: end(range.to) };
  });
}
