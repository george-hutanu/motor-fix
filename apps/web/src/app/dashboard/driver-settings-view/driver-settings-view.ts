import { Component } from '@angular/core';

import { DriverNotifications } from '../driver-notifications/driver-notifications';
import { PushPanel } from '../push-panel/push-panel';

// Setări of the driver's dashboard: this device's push panel, then the
// driver's notification switches.
@Component({
  imports: [DriverNotifications, PushPanel],
  selector: 'mf-driver-settings-view',
  styleUrl: './driver-settings-view.css',
  templateUrl: './driver-settings-view.html',
})
export class DriverSettingsView {}
