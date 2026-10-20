import { Component, inject, input, output } from '@angular/core';
import type { BrandDto } from '@motor-fix/data-access/models/brand-dto';
import { TranslatePipe } from '@motor-fix/i18n';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

// The most searched brands, moving left in a loop under the picker. The list
// is doubled only so the loop has no seam: the copy is hidden from assistive
// technology and the keyboard, which meet each brand once. Under reduced
// motion it stands still and scrolls by hand.
@Component({
  imports: [TranslatePipe],
  selector: 'mf-brand-strip',
  styleUrl: './brand-strip.css',
  templateUrl: './brand-strip.html',
})
export class BrandStrip {
  readonly brands = input.required<BrandDto[]>();
  readonly pick = output<BrandDto>();
  protected readonly reduced = inject(REDUCED_MOTION);
}
