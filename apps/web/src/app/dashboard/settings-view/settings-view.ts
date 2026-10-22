import { Component, computed, inject } from '@angular/core';

import { CopyVoices } from '../copy-voices/copy-voices';
import { FeatureSwitches } from '../feature-switches/feature-switches';
import { NotificationSettings } from '../notification-settings/notification-settings';
import { PlatformRules } from '../platform-rules/platform-rules';
import { PrivacyPanel } from '../privacy-panel/privacy-panel';
import { PushPanel } from '../push-panel/push-panel';
import { Session } from '../session';

// Setări of the garage and admin dashboards: for an admin the platform rules
// and the copy voices first, for a garage's owner its feature switches, then this device's push panel and the person's
// staff notification choices. Both admin sections load in a chunk of their
// own (@defer), out of the first bundle.
@Component({
  imports: [
    CopyVoices,
    FeatureSwitches,
    NotificationSettings,
    PlatformRules,
    PrivacyPanel,
    PushPanel,
  ],
  selector: 'mf-dashboard-settings-view',
  templateUrl: './settings-view.html',
})
export class SettingsView {
  private readonly session = inject(Session);

  protected readonly admin = computed(
    () =>
      this.session.current()?.capabilities.includes('admin.settings') ?? false,
  );
  protected readonly owner = computed(
    () =>
      this.session
        .current()
        ?.capabilities.includes('garage.feature_switches') ?? false,
  );
}
