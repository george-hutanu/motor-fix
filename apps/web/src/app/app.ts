import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { MaintenanceBanner } from './maintenance/maintenance-banner/maintenance-banner';
import { MaintenancePage } from './maintenance/maintenance-page/maintenance-page';
import { PlatformStatus } from './maintenance/platform-status';

// The screen stays under the maintenance page, so it comes back as it was.
@Component({
  imports: [MaintenanceBanner, MaintenancePage, RouterOutlet],
  selector: 'mf-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly status = inject(PlatformStatus);
}
