import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { DriverSettingsView } from './driver-settings-view';
import { DeleteAccount } from '../delete-account/delete-account';
import { DriverNotifications } from '../driver-notifications/driver-notifications';
import { MyDetails } from '../my-details/my-details';
import { PrivacyPanel } from '../privacy-panel/privacy-panel';
import { PushPanel } from '../push-panel/push-panel';

@Component({ selector: 'mf-my-details', template: '' })
class FakeMyDetails {}

@Component({ selector: 'mf-push-panel', template: '' })
class FakePushPanel {}

@Component({ selector: 'mf-driver-notifications', template: '' })
class FakeNotifications {}

@Component({ selector: 'mf-privacy-panel', template: '' })
class FakePrivacyPanel {}

@Component({ selector: 'mf-delete-account', template: '' })
class FakeDeleteAccount {}

describe("the driver's settings", () => {
  // @traces 139-FR-001 244-FR-006 244-FR-015 129-FR-014
  // The news switch stays in the notification switches, before the panel.
  it("shows the driver's details, this device's push panel, the notification switches, the privacy panel, then the delete-account row", () => {
    TestBed.overrideComponent(DriverSettingsView, {
      add: {
        imports: [
          FakeMyDetails,
          FakePushPanel,
          FakeNotifications,
          FakePrivacyPanel,
          FakeDeleteAccount,
        ],
      },
      remove: {
        imports: [
          MyDetails,
          PushPanel,
          DriverNotifications,
          PrivacyPanel,
          DeleteAccount,
        ],
      },
    });
    const fixture = TestBed.createComponent(DriverSettingsView);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect([...element.children].map((c) => c.tagName.toLowerCase())).toEqual([
      'mf-my-details',
      'mf-push-panel',
      'mf-driver-notifications',
      'mf-privacy-panel',
      'mf-delete-account',
    ]);
  });
});
