import { Component } from '@angular/core';

import { DriverNotifications } from '../driver-notifications/driver-notifications';
import { MyDetails } from '../my-details/my-details';
import { PushPanel } from '../push-panel/push-panel';

// Setări of the driver's dashboard: the driver's details, this device's
// push panel, then the driver's notification switches.
@Component({
  imports: [DriverNotifications, MyDetails, PushPanel],
  selector: 'mf-driver-settings-view',
  styleUrl: './driver-settings-view.css',
  templateUrl: './driver-settings-view.html',
})
export class DriverSettingsView {}
