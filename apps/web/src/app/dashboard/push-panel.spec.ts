import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { toast } from '@motor-fix/ui-cockpit';

import { PushDevice, type PushState } from './push-device';
import { PushPanel } from './push-panel';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

let state: ReturnType<typeof signal<PushState>>;
let device: {
  busy: ReturnType<typeof signal<boolean>>;
  disable: jest.Mock;
  enable: jest.Mock;
  failed: ReturnType<typeof signal<boolean>>;
  refresh: jest.Mock;
  state: typeof state;
  test: jest.Mock;
};

async function render(initial: PushState, language: 'ro' | 'en' = 'ro') {
  state = signal<PushState>(initial);
  device = {
    busy: signal(false),
    disable: jest.fn(async () => undefined),
    enable: jest.fn(async () => undefined),
    failed: signal(false),
    refresh: jest.fn(async () => undefined),
    state,
    test: jest.fn(async () => true),
  };
  TestBed.configureTestingModule({
    providers: [{ provide: PushDevice, useValue: device }],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(PushPanel);
  fixture.detectChanges();
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const buttons = () =>
    [...element.querySelectorAll('button')].map((b) => b.textContent?.trim());
  return { buttons, element, fixture };
}

describe('PushPanel', () => {
  it('shows nothing while loading, and reads the state when it opens', async () => {
    const { element } = await render('loading');
    expect(element.querySelector('section')).toBeNull();
    expect(device.refresh).toHaveBeenCalled();
  });

  it('offers only the enable button when off, and asks permission on the tap alone', async () => {
    const { element, buttons } = await render('off');
    expect(buttons()).toEqual(['Activează notificările']);
    expect(device.enable).not.toHaveBeenCalled();
    element.querySelector('button')?.click();
    expect(device.enable).toHaveBeenCalledTimes(1);
  });

  it('offers turn off and test when on', async () => {
    const { element, buttons, fixture } = await render('on');
    expect(buttons()).toEqual(['Dezactivează', 'Trimite o notificare de test']);
    const [off, test] = [...element.querySelectorAll('button')];
    off.click();
    expect(device.disable).toHaveBeenCalled();
    test.click();
    await fixture.whenStable();
    expect(device.test).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('Am trimis o notificare de test.');
  });

  it('does not say the test was sent when it was not', async () => {
    const { element, fixture } = await render('on');
    device.test.mockResolvedValue(false);
    jest.mocked(toast).mockClear();
    element.querySelectorAll('button')[1].click();
    await fixture.whenStable();
    expect(toast).not.toHaveBeenCalled();
  });

  it.each([
    ['blocked', 'Notificările sunt blocate în browser'],
    ['ios-hint', 'Adaugă pe ecranul principal'],
    ['unsupported', 'Acest browser nu poate primi notificări.'],
    ['unavailable', 'Notificările nu sunt disponibile încă.'],
  ] as const)('says %s with no button', async (name, text) => {
    const { element, buttons } = await render(name);
    expect(element.textContent).toContain(text);
    expect(buttons()).toEqual([]);
  });

  it('disables the buttons while busy and shows the error with retry', async () => {
    const { element, fixture } = await render('off');
    device.busy.set(true);
    device.failed.set(true);
    fixture.detectChanges();
    expect(element.querySelector('button')?.disabled).toBe(true);
    expect(element.querySelector('[role=alert]')?.textContent).toContain(
      'Nu a mers',
    );
  });

  it('reads in English', async () => {
    const { buttons } = await render('off', 'en');
    expect(buttons()).toEqual(['Turn on notifications']);
  });
});
