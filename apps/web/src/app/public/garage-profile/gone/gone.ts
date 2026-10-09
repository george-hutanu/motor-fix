import { booleanAttribute, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18n, TranslatePipe } from '@motor-fix/i18n';

// A garage that was listed and is no longer, or one nobody can see (`missing`,
// the not-found texts): nothing of it is shown. Inside the public frame, so no
// landmarks of its own.
@Component({
  imports: [RouterLink, TranslatePipe],
  selector: 'mf-gone',
  styleUrl: './gone.css',
  templateUrl: './gone.html',
})
export class Gone {
  readonly missing = input(false, { transform: booleanAttribute });
  protected readonly i18n = inject(I18n);
}
