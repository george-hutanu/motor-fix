import { Component, computed, inject } from '@angular/core';

import { NotificationSettings } from '../notification-settings/notification-settings';
import { PlatformRules } from '../platform-rules/platform-rules';
import { PushPanel } from '../push-panel/push-panel';
import { Session } from '../session';

// Setări of the garage and admin dashboards: for an admin the platform rules
// first, then this device's push panel and the person's staff notification
// choices. The rules are admin-only and load in a chunk of their own
// (@defer), out of the first bundle.
@Component({
  imports: [NotificationSettings, PlatformRules, PushPanel],
  selector: 'mf-dashboard-settings-view',
  templateUrl: './settings-view.html',
})
export class SettingsView {
  private readonly session = inject(Session);

  protected readonly admin = computed(
    () =>
      this.session.current()?.capabilities.includes('admin.settings') ?? false,
  );
}
