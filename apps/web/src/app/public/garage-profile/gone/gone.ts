import {
  booleanAttribute,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type {
  SimilarGarageDto,
  SimilarGaragesDto,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';

import { ResultCard } from '../../results/result-card/result-card';

// A garage that was listed and is no longer, with the listed garages like it
// nearby, or one nobody can see (`missing`, the not-found texts): nothing of
// it is shown. Inside the public frame, so no landmarks of its own.
@Component({
  imports: [ResultCard, RouterLink, TranslatePipe],
  selector: 'mf-gone',
  styleUrl: './gone.css',
  templateUrl: './gone.html',
})
export class Gone {
  readonly missing = input(false, { transform: booleanAttribute });
  // Undefined while it is read, null when the read failed: the way back to
  // search.
  readonly similar = input<SimilarGaragesDto | null>();
  protected readonly i18n = inject(I18n);
  private readonly router = inject(Router);

  protected readonly cards = computed(
    () => this.similar()?.items?.slice(0, 3) ?? [],
  );

  // A tap on the card, as on the results, opens the garage it shows.
  protected open(item: SimilarGarageDto) {
    void this.router.navigate(
      ['/', this.i18n.language(), 'garages', item.slug],
      { queryParams: { brand: item.brand.slug } },
    );
  }
}
