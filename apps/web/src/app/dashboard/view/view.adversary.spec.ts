import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import type { MeDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { BehaviorSubject } from 'rxjs';

import { View } from './view';
import { Session } from '../session';
import { DASHBOARDS } from '../views';

const reviews = DASHBOARDS.driver.views.find((v) => v.path === 'reviews')!;
const settings = DASHBOARDS.driver.views.find((v) => v.path === 'settings')!;

const text = (e: Element | null) =>
  (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function mount(data: unknown) {
  const current = signal({ capabilities: [] } as unknown as MeDto);
  const route = new BehaviorSubject<unknown>(data);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Session, useValue: { current, shown: current } },
      { provide: ActivatedRoute, useValue: { data: route } },
    ],
  });
  const fixture = TestBed.createComponent(View);
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r));
    }
  };
  await settle();
  return { element: fixture.nativeElement as HTMLElement, route, settle };
}

afterEach(() => TestBed.resetTestingModule());

describe('a view body under odd routes', () => {
  it('shows the generic text, not an empty state, for a view with no empty state', async () => {
    const { element } = await mount({ area: 'driver', view: settings });

    expect(element.querySelector('mf-empty-state')).toBeNull();
    expect(text(element)).toBe('Nimic aici încă.');
  });

  it('survives a route with no data and shows the generic text', async () => {
    const { element } = await mount({});

    expect(element.querySelector('mf-empty-state')).toBeNull();
    expect(text(element)).toBe('Nimic aici încă.');
  });

  it('swaps from the reviews state to the generic text when the route changes in place', async () => {
    const { element, route, settle } = await mount({
      area: 'driver',
      view: reviews,
    });
    route.next({ area: 'driver', view: settings });
    await settle();

    expect(element.querySelector('mf-empty-state')).toBeNull();
    expect(text(element)).toBe('Nimic aici încă.');
  });

  it('shows the English empty text when the reader switched language after it rendered', async () => {
    const { element, settle } = await mount({ area: 'driver', view: reviews });
    await TestBed.inject(I18n).use('en');
    await settle();

    expect(text(element)).toBe(
      'No reviews yet. After a repair through MotorFix we ask what you think.',
    );
  });
});
