import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { DriverSettingsView } from './driver-settings-view';
import { DriverNotifications } from '../driver-notifications/driver-notifications';
import { PrivacyPanel } from '../privacy-panel/privacy-panel';
import { PushPanel } from '../push-panel/push-panel';

@Component({ selector: 'mf-push-panel', template: '' })
class FakePushPanel {}

@Component({ selector: 'mf-driver-notifications', template: '' })
class FakeNotifications {}

@Component({ selector: 'mf-privacy-panel', template: '' })
class FakePrivacyPanel {}

describe("the driver's settings", () => {
  // @traces 244-FR-006
  it("shows this device's push panel, the notification switches, then the privacy panel", () => {
    TestBed.overrideComponent(DriverSettingsView, {
      add: { imports: [FakePushPanel, FakeNotifications, FakePrivacyPanel] },
      remove: { imports: [PushPanel, DriverNotifications, PrivacyPanel] },
    });
    const fixture = TestBed.createComponent(DriverSettingsView);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect([...element.children].map((c) => c.tagName.toLowerCase())).toEqual([
      'mf-push-panel',
      'mf-driver-notifications',
      'mf-privacy-panel',
    ]);
  });
});
