import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { capabilitiesOf, type Role } from '@motor-fix/contracts/capabilities';
import type { MeDto } from '@motor-fix/data-access';

import { SectionTitle } from './section-title';
import { Session } from '../session';

const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};

const account = (role: Role, features: Record<string, boolean> = {}) =>
  ({
    capabilities: capabilitiesOf(role, NONE),
    garageAccess: [
      {
        features,
        garageId: 'garage-1',
        name: 'Atelier Test',
        permissions: NONE,
        role: role === 'garage' ? 'owner' : role,
        status: 'approved',
      },
    ],
    garageId: 'garage-1',
  }) as unknown as MeDto;

async function render(me: MeDto, view: string) {
  const shown = signal(me);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Session, useValue: { current: shown, shown } },
    ],
  });
  const fixture = TestBed.createComponent(SectionTitle);
  fixture.componentRef.setInput('heading', 'Încărcarea mecanicilor azi');
  fixture.componentRef.setInput('view', view);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { element: fixture.nativeElement as HTMLElement, fixture, shown };
}

// @traces 099-FR-003
// @traces 099-FR-010
describe('a section title on Panou', () => {
  it('is one heading that links to the view the menu holds', async () => {
    const { element } = await render(account('garage'), 'team');
    const headings = element.querySelectorAll('h2');
    const link = element.querySelector('h2 > a');

    expect(headings).toHaveLength(1);
    expect(link?.getAttribute('href')).toBe('/app/garage/team');
    expect(link?.textContent?.trim()).toBe('Încărcarea mecanicilor azi');
  });

  it('is plain text where the menu lacks the view', async () => {
    const { element } = await render(account('mechanic'), 'team');

    expect(element.querySelector('a')).toBeNull();
    expect(element.querySelector('h2')?.textContent?.trim()).toBe(
      'Încărcarea mecanicilor azi',
    );
  });

  it('follows the account when a feature is switched off', async () => {
    const { element, fixture, shown } = await render(
      account('garage'),
      'schedule',
    );
    expect(element.querySelector('a')).not.toBeNull();

    shown.set(account('garage', { day_sheets: false }));
    fixture.detectChanges();

    expect(element.querySelector('a')).toBeNull();
  });
});
