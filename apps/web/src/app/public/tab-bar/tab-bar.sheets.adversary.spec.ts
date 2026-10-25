import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { MeDto } from '@motor-fix/data-access';
import { OpenSheets, Overlays } from '@motor-fix/overlays';
import { Subject } from 'rxjs';

import { provideLanguageAddresses, SITE_ORIGIN } from '../../addresses';
import { routes } from '../../app.routes';
import { Session } from '../../dashboard/session';

let harness: RouterTestingHarness;

async function open(platform = 'browser') {
  const current = signal<MeDto | null>(null);
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      provideLanguageAddresses(),
      { provide: SITE_ORIGIN, useValue: 'https://motorfix.ro' },
      {
        provide: Session,
        useValue: {
          current,
          ended: new Subject<void>(),
          keepReturnTo: jest.fn(),
          load: jest.fn(async () => null),
          roleHint: signal(null),
          shown: current,
          takeReturnTo: jest.fn((): string | null => null),
          token: () => 'access',
        },
      },
      { provide: PLATFORM_ID, useValue: platform },
      {
        provide: Overlays,
        useValue: { open: jest.fn(async () => 'cancelled') },
      },
    ],
  });
  harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/ro');
  await settle();
}

async function settle() {
  for (let i = 0; i < 4; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
    await harness?.fixture.whenStable();
  }
}

const bar = () =>
  (harness.fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
    'mf-public-tab-bar',
  );

describe('the public tab bar under sheets', () => {
  // @traces 1127-FR-004
  it('hides by visibility alone and keeps the navigation in the DOM', async () => {
    await open();
    TestBed.inject(OpenSheets).opened();
    await settle();

    expect(bar()?.hidden).toBe(false);
    expect(bar()?.style.visibility).toBe('hidden');
    expect(bar()?.querySelectorAll('nav a')).toHaveLength(3);
  });

  // @traces 1127-FR-004
  it('is not left hidden by stray closes before the first sheet', async () => {
    await open();
    const sheets = TestBed.inject(OpenSheets);
    sheets.closed();
    sheets.closed();
    sheets.opened();
    await settle();
    expect(bar()?.style.visibility).toBe('hidden');

    sheets.closed();
    await settle();
    expect(bar()?.style.visibility).toBe('');
  });

  // @traces 1127-FR-004
  it('stays hidden with two stacked sheets until the second closes', async () => {
    await open();
    const sheets = TestBed.inject(OpenSheets);
    sheets.opened();
    sheets.opened();
    sheets.closed();
    await settle();
    expect(bar()?.style.visibility).toBe('hidden');

    sheets.closed();
    await settle();
    expect(bar()?.style.visibility).toBe('');
  });

  // @traces 1127-FR-004
  it('keeps typing and the sheet independent: typing alone sets hidden and no visibility', async () => {
    await open();
    const field = document.createElement('input');
    document.body.append(field);
    field.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await settle();

    expect(bar()?.hidden).toBe(true);
    expect(bar()?.style.visibility).toBe('');
    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    field.remove();
    await settle();
    expect(bar()?.hidden).toBe(false);
  });

  // @traces 1127-FR-004
  it('shows again after the sheet closes even when the field lost focus first', async () => {
    await open();
    const sheets = TestBed.inject(OpenSheets);
    const field = document.createElement('input');
    document.body.append(field);

    field.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    sheets.opened();
    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    field.remove();
    sheets.closed();
    await settle();

    expect(bar()?.hidden).toBe(false);
    expect(bar()?.style.visibility).toBe('');
  });

  // @traces 1127-FR-004
  it('renders visible on the server with no sheet open', async () => {
    await open('server');

    expect(TestBed.inject(OpenSheets).any()).toBe(false);
    expect(bar()?.style.visibility ?? '').toBe('');
  });
});
