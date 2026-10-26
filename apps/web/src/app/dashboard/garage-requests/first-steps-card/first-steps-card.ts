import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@motor-fix/i18n';

// "Primii pași": what the owner of a newly verified garage can do before the
// first request, each line a link to the view that does it.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe],
  selector: 'mf-first-steps-card',
  styleUrl: './first-steps-card.css',
  templateUrl: './first-steps-card.html',
})
export class FirstStepsCard {
  // Whether the menu holds Mecanici.
  readonly team = input(false);
}
