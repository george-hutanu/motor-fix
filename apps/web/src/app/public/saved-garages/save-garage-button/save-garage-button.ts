import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { TranslatePipe } from '@motor-fix/i18n';

import { confirmRoleHint, Session } from '../../../dashboard/session';
import { SavedGarages } from '../saved-garages';

// "Salvează" on a garage's profile (labelled) and the bookmark on a result
// card (icon). A visitor or a driver sees it, as with "Cere ofertă"; a
// garage-side role does not. The store does the work.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  selector: 'mf-save-garage-button',
  styleUrl: './save-garage-button.css',
  templateUrl: './save-garage-button.html',
})
export class SaveGarageButton {
  readonly garageId = input.required<string>();
  readonly look = input<'labelled' | 'icon'>('labelled');
  private readonly saved = inject(SavedGarages);
  private readonly session = inject(Session);

  protected readonly shown = computed(() => {
    const role = this.session.current()?.role ?? this.session.roleHint();
    return role === null || role === 'driver';
  });
  protected readonly pressed = computed(() =>
    this.saved.ids().has(this.garageId()),
  );
  protected readonly unavailable = computed(() =>
    this.saved.unavailable().has(this.garageId()),
  );
  protected readonly label = computed(() =>
    this.pressed() ? 'public.saveGarage.saved' : 'public.saveGarage.save',
  );

  constructor() {
    confirmRoleHint(this.session);
  }

  // On a card the button sits beside the profile link: the tap stays here.
  protected tap(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    void this.saved.tap(this.garageId());
  }
}
