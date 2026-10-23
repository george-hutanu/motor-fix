import { Component, signal } from '@angular/core';
import { DeferBlockState, TestBed } from '@angular/core/testing';
import type { MeDto } from '@motor-fix/data-access';

import { SettingsView } from './settings-view';
import { Session } from '../session';

@Component({ selector: 'mf-platform-rules', template: '' })
class PlatformRulesStub {}

@Component({ selector: 'mf-copy-voices', template: '' })
class CopyVoicesStub {}

@Component({ selector: 'mf-feature-switches', template: '' })
class FeatureSwitchesStub {}

@Component({ selector: 'mf-push-panel', template: '' })
class PushPanelStub {}

@Component({ selector: 'mf-notification-settings', template: '' })
class NotificationSettingsStub {}

@Component({ selector: 'mf-privacy-panel', template: '' })
class PrivacyPanelStub {}

@Component({ selector: 'mf-delete-account', template: '' })
class DeleteAccountStub {}

const account = (capabilities: string[]) =>
  ({ capabilities, id: 'account-1' }) as unknown as MeDto;

function render(me: MeDto | null) {
  TestBed.configureTestingModule({
    providers: [{ provide: Session, useValue: { current: signal(me) } }],
  });
  TestBed.overrideComponent(SettingsView, {
    set: {
      imports: [
        CopyVoicesStub,
        DeleteAccountStub,
        FeatureSwitchesStub,
        NotificationSettingsStub,
        PlatformRulesStub,
        PrivacyPanelStub,
        PushPanelStub,
      ],
    },
  });
  const fixture = TestBed.createComponent(SettingsView);
  fixture.detectChanges();
  return fixture;
}

async function rendered(me: MeDto | null) {
  const fixture = render(me);
  for (const block of await fixture.getDeferBlocks()) {
    await block.render(DeferBlockState.Complete);
  }
  return fixture.nativeElement as HTMLElement;
}

describe('SettingsView', () => {
  // The rules and their two-admin confirmation are admin-only, so
  // they load in a chunk of their own and stay out of the web app's
  // first bundle, which the 1 MB budget caps.
  it('loads the platform rules in a deferred block, apart from the first bundle', async () => {
    const fixture = render(account(['admin.settings']));

    expect(await fixture.getDeferBlocks()).toHaveLength(1);
  });

  it('defers nothing for a garage session', async () => {
    const fixture = render(account(['garage.settings']));

    expect(await fixture.getDeferBlocks()).toHaveLength(0);
  });

  it('shows the platform rules first to an admin', async () => {
    const element = await rendered(account(['admin.settings']));

    expect(element.firstElementChild?.tagName).toBe('MF-PLATFORM-RULES');
    expect(element.querySelector('mf-push-panel')).not.toBeNull();
  });

  // @traces 010-FR-012
  it('shows the copy voices right after the platform rules to an admin', async () => {
    const element = await rendered(account(['admin.settings']));

    expect(element.children[1]?.tagName).toBe('MF-COPY-VOICES');
  });

  it('shows no platform rules to a garage session', async () => {
    const element = await rendered(account(['garage.settings']));

    expect(element.querySelector('mf-platform-rules')).toBeNull();
    expect(element.querySelector('mf-copy-voices')).toBeNull();
    expect(element.querySelector('mf-notification-settings')).not.toBeNull();
  });

  // @traces 244-FR-006 129-FR-014
  it('ends with the privacy panel, then the delete-account row', async () => {
    const element = await rendered(account(['garage.settings']));

    expect(element.lastElementChild?.previousElementSibling?.tagName).toBe(
      'MF-PRIVACY-PANEL',
    );
    expect(element.lastElementChild?.tagName).toBe('MF-DELETE-ACCOUNT');
  });

  // @traces 398-FR-001
  it('shows the feature switches first, before the push, notification and privacy panels, to the owner', async () => {
    const element = await rendered(
      account(['garage.settings', 'garage.feature_switches']),
    );

    expect(element.firstElementChild?.tagName).toBe('MF-FEATURE-SWITCHES');
    expect(element.children[1]?.tagName).toBe('MF-PUSH-PANEL');
  });

  // @traces 398-FR-001
  it.each([
    ['a receptionist', ['garage.settings', 'garage.requests']],
    ['a mechanic', ['garage.settings', 'garage.own_jobs']],
  ])('shows no feature switches to %s', async (_who, capabilities) => {
    const element = await rendered(account(capabilities));

    expect(element.querySelector('mf-feature-switches')).toBeNull();
    expect(element.querySelector('mf-notification-settings')).not.toBeNull();
  });
});
