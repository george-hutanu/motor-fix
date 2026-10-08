import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { DriverSettingsView } from './driver-settings-view';
import { DriverNotifications } from '../driver-notifications/driver-notifications';
import { PushPanel } from '../push-panel/push-panel';

@Component({ selector: 'mf-push-panel', template: '' })
class FakePushPanel {}

@Component({ selector: 'mf-driver-notifications', template: '' })
class FakeNotifications {}

describe("the driver's settings", () => {
  it("shows this device's push panel, then the notification switches", () => {
    TestBed.overrideComponent(DriverSettingsView, {
      add: { imports: [FakePushPanel, FakeNotifications] },
      remove: { imports: [PushPanel, DriverNotifications] },
    });
    const fixture = TestBed.createComponent(DriverSettingsView);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect([...element.children].map((c) => c.tagName.toLowerCase())).toEqual([
      'mf-push-panel',
      'mf-driver-notifications',
    ]);
  });
});
