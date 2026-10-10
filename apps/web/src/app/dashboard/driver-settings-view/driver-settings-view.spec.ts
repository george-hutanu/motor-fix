import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { DriverSettingsView } from './driver-settings-view';
import { DriverNotifications } from '../driver-notifications/driver-notifications';
import { MyDetails } from '../my-details/my-details';
import { PushPanel } from '../push-panel/push-panel';

@Component({ selector: 'mf-my-details', template: '' })
class FakeMyDetails {}

@Component({ selector: 'mf-push-panel', template: '' })
class FakePushPanel {}

@Component({ selector: 'mf-driver-notifications', template: '' })
class FakeNotifications {}

describe("the driver's settings", () => {
  // @traces 139-FR-001
  it("shows the driver's details, this device's push panel, then the notification switches", () => {
    TestBed.overrideComponent(DriverSettingsView, {
      add: { imports: [FakeMyDetails, FakePushPanel, FakeNotifications] },
      remove: { imports: [MyDetails, PushPanel, DriverNotifications] },
    });
    const fixture = TestBed.createComponent(DriverSettingsView);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect([...element.children].map((c) => c.tagName.toLowerCase())).toEqual([
      'mf-my-details',
      'mf-push-panel',
      'mf-driver-notifications',
    ]);
  });
});
