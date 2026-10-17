import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { GarageSuspensionDto, MeDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { SuspendedBanner } from './suspended-banner';
import { Session } from '../../session';

const REASON = 'Autorizație RAR expirată pe 12 sept. 2026';

const owner = (
  status: string,
  suspension: GarageSuspensionDto | null = null,
): MeDto =>
  ({
    capabilities: [],
    email: 'mihai@example.test',
    emailConfirmed: true,
    garageAccess: [
      {
        garageId: 'garage-1',
        name: 'Atelier Dinamo',
        role: 'owner',
        status,
        suspension,
      },
    ],
    garageId: 'garage-1',
    id: 'account-1',
    landing: '/app/garage',
    language: 'ro',
    name: 'Mihai Popescu',
    role: 'garage',
    roles: ['garage'],
  }) as unknown as MeDto;

const suspended = (cause: GarageSuspensionDto['cause'], reason = REASON) =>
  owner('suspended', { cause, reason });

async function render(me: MeDto | null, language: 'ro' | 'en' = 'ro') {
  const shown = signal<MeDto | null>(me);
  TestBed.configureTestingModule({
    providers: [{ provide: Session, useValue: { current: shown, shown } }],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('garage');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(SuspendedBanner);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const alertOf = (element: HTMLElement) =>
  element.querySelector('[role="alert"]');

// @traces 049-FR-012 049-FR-015
describe('SuspendedBanner', () => {
  it('tells the owner in Romanian that the profile is off the map, why, and what to do', async () => {
    const element = await render(suspended('recheck_failed'));

    const text = alertOf(element)?.textContent?.replace(/\s+/g, ' ').trim();
    expect(text).toContain(
      `Profil suspendat · ${REASON}. Profilul nu apare pe hartă până se rezolvă.`,
    );
    expect(text).toContain('Încarcă autorizația RAR reînnoită.');
  });

  it('says the same in English', async () => {
    const element = await render(suspended('recheck_failed'), 'en');

    const text = alertOf(element)?.textContent?.replace(/\s+/g, ' ').trim();
    expect(text).toContain(
      `Profile suspended · ${REASON}. The profile is off the map until this is fixed.`,
    );
    expect(text).toContain('Upload the renewed RAR authorisation.');
  });

  it.each([
    [
      'recheck_failed',
      'Încarcă autorizația RAR reînnoită.',
      'Upload the renewed RAR authorisation.',
    ],
    [
      'documents_overdue',
      'Încarcă documentele anuale.',
      'Upload the yearly documents.',
    ],
    ['admin', 'Răspunde echipei MotorFix.', 'Answer the MotorFix team.'],
    [
      'report_confirmed',
      'Răspunde echipei MotorFix.',
      'Answer the MotorFix team.',
    ],
  ] as const)('names the next step for %s', async (cause, ro, en) => {
    expect(alertOf(await render(suspended(cause)))?.textContent).toContain(ro);
    TestBed.resetTestingModule();
    expect(
      alertOf(await render(suspended(cause), 'en'))?.textContent,
    ).toContain(en);
  });

  it('shows a reason with markup as plain text', async () => {
    const element = await render(
      suspended('admin', '<img src=x onerror=alert(1)> motiv'),
    );

    expect(element.querySelector('img')).toBeNull();
    expect(alertOf(element)?.textContent).toContain(
      '<img src=x onerror=alert(1)> motiv',
    );
  });

  it.each([
    ['an approved garage', owner('approved')],
    ['a draft garage', owner('draft')],
    ['no account', null],
  ])('shows nothing for %s', async (_, me) => {
    expect(alertOf(await render(me))).toBeNull();
  });
});
