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

async function render(me: MeDto | null, heading: string, view: string) {
  const shown = signal(me);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Session, useValue: { current: shown, shown } },
    ],
  });
  const fixture = TestBed.createComponent(SectionTitle);
  fixture.componentRef.setInput('heading', heading);
  fixture.componentRef.setInput('view', view);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { element: fixture.nativeElement as HTMLElement, fixture, shown };
}

afterEach(() => TestBed.resetTestingModule());

// @traces 099-FR-003
describe('a section title under hostile input', () => {
  it('renders markup in the heading as text, never as elements', async () => {
    const { element } = await render(
      account('garage'),
      '<img src=x onerror=alert(1)>',
      'team',
    );

    expect(element.querySelector('img')).toBeNull();
    expect(element.querySelector('h2')?.textContent?.trim()).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('stays one plain heading for a view that does not exist', async () => {
    const { element } = await render(account('garage'), 'Titlu', 'nonsense');

    expect(element.querySelectorAll('h2')).toHaveLength(1);
    expect(element.querySelector('a')).toBeNull();
  });

  it('stays a plain heading with no account at all', async () => {
    const { element } = await render(null, 'Titlu', 'team');

    expect(element.querySelector('a')).toBeNull();
    expect(element.querySelector('h2')?.textContent?.trim()).toBe('Titlu');
  });

  it('keeps one heading when the heading is empty', async () => {
    const { element } = await render(account('garage'), '', 'team');

    expect(element.querySelectorAll('h2')).toHaveLength(1);
  });

  it('keeps unicode and long headings intact in the link name', async () => {
    const long = 'Ștefan Țepeș ăîâ '.repeat(200).trim();
    const { element } = await render(account('garage'), long, 'team');

    expect(element.querySelector('h2 > a')?.textContent?.trim()).toBe(long);
  });

  it('turns a plain heading into a link when the feature comes back on', async () => {
    const { element, fixture, shown } = await render(
      account('garage', { team_mechanics: false }),
      'Titlu',
      'team',
    );
    expect(element.querySelector('a')).toBeNull();

    shown.set(account('garage'));
    fixture.detectChanges();

    expect(element.querySelector('h2 > a')?.getAttribute('href')).toBe(
      '/app/garage/team',
    );
  });

  it('drops the link when the account is cleared', async () => {
    const { element, fixture, shown } = await render(
      account('garage'),
      'Titlu',
      'team',
    );

    shown.set(null);
    fixture.detectChanges();

    expect(element.querySelector('a')).toBeNull();
    expect(element.querySelectorAll('h2')).toHaveLength(1);
  });

  it('follows a changed view input', async () => {
    const { element, fixture } = await render(
      account('garage'),
      'Titlu',
      'team',
    );
    fixture.componentRef.setInput('view', 'reviews');
    fixture.detectChanges();

    expect(element.querySelector('h2 > a')?.getAttribute('href')).toBe(
      '/app/garage/reviews',
    );
  });
});
