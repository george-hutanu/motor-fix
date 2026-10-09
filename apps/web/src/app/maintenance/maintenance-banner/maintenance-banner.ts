import { Component } from '@angular/core';
import { TranslatePipe } from '@motor-fix/i18n';

// Above every page for a signed-in admin while the site is in maintenance.
@Component({
  imports: [TranslatePipe],
  selector: 'mf-maintenance-banner',
  styleUrl: './maintenance-banner.css',
  templateUrl: './maintenance-banner.html',
})
export class MaintenanceBanner {}
