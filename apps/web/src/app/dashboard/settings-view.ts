import { Component } from '@angular/core';

import { NotificationSettings } from './notification-settings';
import { PushPanel } from './push-panel';

// Setări of the garage and admin dashboards: this device's push panel, then
// the person's staff notification choices.
@Component({
  imports: [NotificationSettings, PushPanel],
  selector: 'mf-dashboard-settings-view',
  template: `<mf-push-panel /><mf-notification-settings />`,
})
export class SettingsView {}
