import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { MeDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { SuspendedBanner } from './suspended-banner';
import { Session } from '../../session';

const access = (extra: Record<string, unknown>, id = 'garage-1') => ({
  garageId: id,
  name: 'Atelier',
  role: 'owner',
  status: 'suspended',
  suspension: null,
  ...extra,
});

const me = (garageAccess: unknown[], garageId: string | null = 'garage-1') =>
  ({
    capabilities: [],
    garageAccess,
    garageId,
    id: 'a',
    language: 'ro',
    role: 'garage',
    roles: ['garage'],
  }) as unknown as MeDto;

async function mount(value: MeDto | null, language: 'ro' | 'en' = 'ro') {
  const shown = signal<MeDto | null>(value);
  TestBed.configureTestingModule({
    providers: [{ provide: Session, useValue: { current: shown, shown } }],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('garage');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(SuspendedBanner);
  fixture.detectChanges();
  await fixture.whenStable();
  return { element: fixture.nativeElement as HTMLElement, fixture, shown };
}

const text = (e: HTMLElement) =>
  e.querySelector('[role="alert"]')?.textContent?.replace(/\s+/g, ' ').trim();

// @traces 049-FR-012
describe('SuspendedBanner under odd sessions', () => {
  it('shows nothing for a suspended garage whose suspension is missing', async () => {
    const { element } = await mount(me([access({})]));
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows nothing when the session holds no garage id', async () => {
    const { element } = await mount(
      me([access({ suspension: { cause: 'admin', reason: 'x' } })], null),
    );
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows nothing for an empty garage list', async () => {
    const { element } = await mount(me([]));
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  it('reads the signed-in garage, not another suspended one', async () => {
    const { element } = await mount(
      me([
        access({ suspension: { cause: 'admin', reason: 'ALTUL' } }, 'garage-2'),
        access({ status: 'approved' }, 'garage-1'),
      ]),
    );
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  it('answers the team for a cause the web does not know', async () => {
    const { element } = await mount(
      me([access({ suspension: { cause: 'future_cause', reason: 'x' } })]),
      'en',
    );
    expect(text(element)).toContain('Answer the MotorFix team.');
  });

  it('shows a 200-character reason and a reason of interpolation braces as written', async () => {
    const reason = `{{ reason }} ${'ă'.repeat(185)}`;
    const { element } = await mount(
      me([access({ suspension: { cause: 'admin', reason } })]),
    );
    expect(text(element)).toContain(`Profil suspendat · ${reason}.`);
  });

  it('appears when the session changes to suspended and goes when it is approved again', async () => {
    const { fixture, shown, element } = await mount(
      me([access({ status: 'approved' })]),
    );
    expect(element.querySelector('[role="alert"]')).toBeNull();

    shown.set(me([access({ suspension: { cause: 'admin', reason: 'Acum' } })]));
    fixture.detectChanges();
    expect(text(element)).toContain('Profil suspendat · Acum.');

    shown.set(me([access({ status: 'approved', suspension: null })]));
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows nothing for a draft garage that carries a stale suspension', async () => {
    const { element } = await mount(
      me([
        access({
          status: 'draft',
          suspension: { cause: 'admin', reason: 'vechi' },
        }),
      ]),
    );
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });
});
