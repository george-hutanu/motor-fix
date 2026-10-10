import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import { RequestsService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { RequestsView } from './requests-view';
import { Live } from '../live';

async function mount(
  answer: () => Promise<unknown>,
  language: 'ro' | 'en' = 'ro',
) {
  const events = new Subject<LiveMessage>();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: RequestsService,
        useValue: { requestsControllerList: jest.fn(answer) },
      },
      {
        provide: Live,
        useValue: {
          events,
          on: (kinds: readonly EventKind[]) =>
            events.pipe(
              filter((m) => (kinds as readonly string[]).includes(m.kind)),
            ),
          resync: new Subject<void>(),
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(RequestsView);
  for (let i = 0; i < 4; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r));
  }
  return fixture.nativeElement as HTMLElement;
}

const text = (e: Element) => (e.textContent ?? '').replace(/\s+/g, ' ').trim();

afterEach(() => TestBed.resetTestingModule());

describe('Cererile mele empty state', () => {
  it('shows the sentence and exactly one link to Home in Romanian', async () => {
    const element = await mount(async () => ({ items: [] }));
    const links = element.querySelectorAll('a');

    expect(text(element.querySelector('mf-empty-state')!)).toBe(
      'Nicio cerere încă. Cere oferte de la mai multe service‑uri deodată.Caută un service',
    );
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/ro');
    expect(element.querySelector('button')).toBeNull();
  });

  it('shows the English sentence and the English Home link', async () => {
    const element = await mount(async () => ({ items: [] }), 'en');

    expect(text(element.querySelector('mf-empty-state')!)).toBe(
      'No requests yet. Ask several garages for a quote at once.Find a garage',
    );
    expect(element.querySelector('a')?.getAttribute('href')).toBe('/en');
  });

  it('shows no empty state while loading or after a failed read', async () => {
    const pending = await mount(() => new Promise(() => {}));
    expect(pending.querySelector('mf-empty-state')).toBeNull();
    TestBed.resetTestingModule();

    const failed = await mount(() => Promise.reject(new Error('down')));
    expect(failed.querySelector('mf-empty-state')).toBeNull();
    expect(text(failed)).toContain('Ceva nu a mers. Încearcă din nou.');
  });
});
