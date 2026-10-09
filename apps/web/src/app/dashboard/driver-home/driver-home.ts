import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton } from '@motor-fix/ui-cockpit';

// The driver dashboard's first view: a request starts from Home, where the
// brand and the results lead to a garage's profile.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, RouterLink, TranslatePipe],
  selector: 'mf-driver-home',
  styleUrl: './driver-home.css',
  templateUrl: './driver-home.html',
})
export class DriverHome {
  private readonly i18n = inject(I18n);
  protected readonly language = this.i18n.language;

  constructor() {
    void this.i18n.enter('driver');
  }
}
