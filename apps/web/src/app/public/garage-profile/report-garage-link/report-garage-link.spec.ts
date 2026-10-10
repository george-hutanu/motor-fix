import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { PublicGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { ReportGarageLink } from './report-garage-link';
import { Session } from '../../../dashboard/session';
import { SignInDialog } from '../../../sign-in/sign-in-dialog';

type Role = 'driver' | 'garage' | 'mechanic' | 'admin';

const GARAGE = {
  id: 'g-dinamo',
  name: 'Atelier Dinamo',
  slug: 'atelier-dinamo',
} as PublicGarageDto;

let open: jest.Mock;
let gate: jest.Mock;

async function render(
  options: {
    role?: Role | null;
    hint?: Exclude<Role, 'admin'> | null;
    answer?: 'sent' | 'gone' | 'cancelled';
    // Who the sign-in gate signs in, or false when it is cancelled.
    signsIn?: Role | false;
    // Who a session renewed on the tap belongs to: a page opened by its
    // address, by someone signed in, has not loaded the session yet.
    restores?: Role;
    language?: 'ro' | 'en';
  } = {},
) {
  const current = signal<{ role: string } | null>(
    options.role ? { role: options.role } : null,
  );
  open = jest.fn(async () => options.answer ?? 'cancelled');
  gate = jest.fn(async () => {
    if (!options.signsIn) return false;
    current.set({ role: options.signsIn });
    return true;
  });
  TestBed.configureTestingModule({
    providers: [
      { provide: Overlays, useValue: { open } },
      { provide: SignInDialog, useValue: { gate } },
      {
        provide: Session,
        useValue: {
          current,
          load: jest.fn(async () => {
            if (!current() && options.restores)
              current.set({ role: options.restores });
            return current();
          }),
          renew: jest.fn(async () => true),
          roleHint: signal(options.hint ?? null),
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  if (options.language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(ReportGarageLink);
  fixture.componentRef.setInput('garage', GARAGE);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const link = (host: HTMLElement) =>
  host.querySelector('button') as HTMLButtonElement | null;

async function press(host: HTMLElement) {
  link(host)?.click();
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  }
}

afterEach(() => TestBed.resetTestingModule());

// @traces 312-FR-001 312-FR-002 312-FR-004
describe('the link to report a garage', () => {
  it('is a quiet button reading Raportează service-ul', async () => {
    const host = await render({ role: 'driver' });

    expect(link(host)?.textContent?.trim()).toBe('Raportează service‑ul');
    expect(link(host)?.type).toBe('button');
    expect(link(host)?.classList).toContain('link');
  });

  it('speaks English', async () => {
    const host = await render({ language: 'en', role: 'driver' });

    expect(link(host)?.textContent?.trim()).toBe('Report this garage');
  });

  it('shows to a driver and a visitor, never to a garage-side role or an admin', async () => {
    expect(link(await render({ role: 'driver' }))).not.toBeNull();
    TestBed.resetTestingModule();
    expect(link(await render({ role: null }))).not.toBeNull();
    TestBed.resetTestingModule();
    expect(link(await render({ role: 'garage' }))).toBeNull();
    TestBed.resetTestingModule();
    expect(link(await render({ role: 'mechanic' }))).toBeNull();
    TestBed.resetTestingModule();
    expect(link(await render({ role: 'admin' }))).toBeNull();
    TestBed.resetTestingModule();
    expect(link(await render({ hint: 'garage' }))).toBeNull();
  });

  it('opens the report task for the garage as a dialog', async () => {
    const host = await render({ role: 'driver' });

    await press(host);

    expect(gate).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][1]).toMatchObject({
      data: { garage: GARAGE },
      shape: 'dialog',
      title: 'public.reportGarage.title',
    });
  });

  it('gives its place to the thank-you line once the report is sent', async () => {
    const host = await render({ answer: 'sent', role: 'driver' });

    await press(host);

    expect(link(host)).toBeNull();
    const thanks = host.querySelector('[role="status"]');
    expect(thanks?.textContent?.trim()).toBe(
      'Mulțumim. Raportarea a ajuns la echipa MotorFix.',
    );
  });

  // A status region inserted with its text already in it is not announced by
  // every screen reader, so the empty region waits on the page from the start.
  it('fills a status line that was already on the page', async () => {
    const host = await render({ answer: 'sent', role: 'driver' });
    const before = host.querySelector('[role="status"]');
    expect(before?.textContent?.trim()).toBe('');

    await press(host);

    expect(host.querySelector('[role="status"]')).toBe(before);
  });

  it('takes the focus to the thank-you line, since the link it was on is gone', async () => {
    const host = await render({ answer: 'sent', role: 'driver' });
    document.body.append(host);
    link(host)?.focus();

    await press(host);

    expect(document.activeElement).toBe(host.querySelector('[role="status"]'));
    host.remove();
  });

  it('stays when the task is cancelled', async () => {
    const host = await render({ answer: 'cancelled', role: 'driver' });

    await press(host);

    expect(link(host)).not.toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent?.trim()).toBe('');
  });

  it('goes away with no message when the garage cannot be reported', async () => {
    const host = await render({ answer: 'gone', role: 'driver' });

    await press(host);

    expect(link(host)).toBeNull();
    expect((host.textContent ?? '').trim()).toBe('');
  });
});

// @traces 312-FR-003
describe('the link to report a garage, for a visitor', () => {
  it('asks the visitor to sign in first', async () => {
    const host = await render({ signsIn: false });

    await press(host);

    expect(gate).toHaveBeenCalledTimes(1);
  });

  it('opens nothing when the sign-in is cancelled', async () => {
    const host = await render({ signsIn: false });

    await press(host);

    expect(open).not.toHaveBeenCalled();
    expect(link(host)).not.toBeNull();
  });

  it('opens nothing and goes away when the sign-in is not a driver', async () => {
    const host = await render({ signsIn: 'garage' });

    await press(host);

    expect(open).not.toHaveBeenCalled();
    expect(link(host)).toBeNull();
  });

  it('opens the report task with no sign-in for a driver whose session loads on the tap', async () => {
    const host = await render({ hint: 'driver', restores: 'driver' });

    await press(host);

    expect(gate).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('opens nothing and goes away when the session that loads is not a driver', async () => {
    const host = await render({ restores: 'garage' });

    await press(host);

    expect([gate.mock.calls.length, open.mock.calls.length]).toEqual([0, 0]);
    expect(link(host)).toBeNull();
  });

  it('opens the report task once the visitor signs in as a driver', async () => {
    const host = await render({ signsIn: 'driver' });

    await press(host);

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][1].data).toEqual({ garage: GARAGE });
  });
});
