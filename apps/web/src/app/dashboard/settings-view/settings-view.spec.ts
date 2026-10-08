import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { MeDto } from '@motor-fix/data-access';

import { SettingsView } from './settings-view';
import { Session } from '../session';

@Component({ selector: 'mf-platform-rules', template: '' })
class PlatformRulesStub {}

@Component({ selector: 'mf-push-panel', template: '' })
class PushPanelStub {}

@Component({ selector: 'mf-notification-settings', template: '' })
class NotificationSettingsStub {}

const account = (capabilities: string[]) =>
  ({ capabilities, id: 'account-1' }) as unknown as MeDto;

function render(me: MeDto | null) {
  TestBed.configureTestingModule({
    providers: [{ provide: Session, useValue: { current: signal(me) } }],
  });
  TestBed.overrideComponent(SettingsView, {
    set: {
      imports: [NotificationSettingsStub, PlatformRulesStub, PushPanelStub],
    },
  });
  const fixture = TestBed.createComponent(SettingsView);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('SettingsView', () => {
  it('shows the platform rules first to an admin', () => {
    const element = render(account(['admin.settings']));

    expect(element.firstElementChild?.tagName).toBe('MF-PLATFORM-RULES');
    expect(element.querySelector('mf-push-panel')).not.toBeNull();
  });

  it('shows no platform rules to a garage session', () => {
    const element = render(account(['garage.settings']));

    expect(element.querySelector('mf-platform-rules')).toBeNull();
    expect(element.querySelector('mf-notification-settings')).not.toBeNull();
  });
});
