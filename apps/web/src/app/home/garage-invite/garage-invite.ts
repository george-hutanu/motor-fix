import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18n, TranslatePipe } from '@motor-fix/i18n';

// Home's last section: a garage is asked to list itself, and the button opens
// the listing form, which needs no account.
@Component({
  imports: [RouterLink, TranslatePipe],
  selector: 'mf-garage-invite',
  styleUrl: './garage-invite.css',
  templateUrl: './garage-invite.html',
})
export class GarageInvite {
  protected readonly i18n = inject(I18n);
}
