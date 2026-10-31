import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { OilLine } from './oil-line';

@Component({
  imports: [OilLine],
  template: `<mf-oil-line [nextServiceKm]="next()" [odometerKm]="odometer()" [serviceDueOn]="due()" [addable]="addable()" (add)="adds = adds + 1" />`,
})
class Host {
  readonly next = signal<number | null>(152000);
  readonly odometer = signal(148200);
  readonly due = signal<string | null | undefined>(undefined);
  readonly addable = signal(false);
  adds = 0;
}

async function render(setup: (h: Host) => void, language: 'ro' | 'en' = 'ro') {
  const i18n = TestBed.inject(I18n);
  await i18n.enter('driver');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(Host);
  setup(fixture.componentInstance);
  fixture.detectChanges();
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  const lamp = root.querySelector('mf-lamp') as HTMLElement;
  return {
    button: root.querySelector('button'),
    host: fixture.componentInstance,
    sentence: (lamp.textContent ?? '').replace(/\s+/g, ' ').trim(),
    state: lamp.getAttribute('data-state'),
  };
}

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'setImmediate',
      'clearImmediate',
      'nextTick',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'performance',
    ],
    now: new Date('2026-10-08T09:00:00+03:00'),
  });
});

afterEach(() => {
  jest.useRealTimers();
  TestBed.resetTestingModule();
});

// @traces 1386-FR-003
describe('the oil line judged by its estimated date', () => {
  it.each([
    ['2027-01-01', 'green', 'Schimb de ulei peste 3.800 km'],
    ['2026-12-08', 'green', 'Schimb de ulei peste 3.800 km'],
    ['2026-12-07', 'amber', 'Schimb de ulei peste 3.800 km'],
    ['2026-10-16', 'amber', 'Schimb de ulei peste 3.800 km'],
    ['2026-10-15', 'red', 'Schimb de ulei peste 3.800 km'],
  ])('shows %s as %s', async (due, state, sentence) => {
    const out = await render((h) => h.due.set(due));
    expect({ sentence: out.sentence, state: out.state }).toEqual({
      sentence,
      state,
    });
  });

  it('shows 1,500 km left on a date 34 days ahead as amber in English', async () => {
    const out = await render((h) => {
      h.next.set(149700);
      h.due.set('2026-11-11');
    }, 'en');
    expect({ sentence: out.sentence, state: out.state }).toEqual({
      sentence: 'Oil service due in 1,500 km',
      state: 'amber',
    });
  });

  it('shows due now in red with a far date', async () => {
    const out = await render((h) => {
      h.next.set(148200);
      h.due.set('2027-06-01');
    });
    expect({ sentence: out.sentence, state: out.state }).toEqual({
      sentence: 'Schimbul de ulei este scadent acum',
      state: 'red',
    });
  });

  it('shows overdue by 200 km in red in English', async () => {
    const out = await render((h) => h.next.set(148000), 'en');
    expect({ sentence: out.sentence, state: out.state }).toEqual({
      sentence: 'Oil service overdue by 200 km',
      state: 'red',
    });
  });

  it('falls back to the default estimate without the date', async () => {
    const out = await render(() => undefined);
    expect(out.state).toBe('green');
  });

  it('falls back to the default estimate for a null date with km left', async () => {
    const out = await render((h) => {
      h.next.set(148300);
      h.due.set(null);
    });
    expect(out.state).toBe('red');
  });
});

// @traces 1386-FR-004
describe('the grey oil line', () => {
  it('is a button saying add the reading when addable', async () => {
    const out = await render((h) => {
      h.next.set(null);
      h.addable.set(true);
    });
    out.button?.click();
    expect({
      adds: out.host.adds,
      sentence: out.sentence,
      state: out.state,
    }).toEqual({
      adds: 1,
      sentence: 'Schimb de ulei: adaugă kilometrajul',
      state: 'grey',
    });
  });

  it('is plain text when not addable', async () => {
    const out = await render((h) => h.next.set(null));
    expect(out.button).toBeNull();
    expect(out.sentence).toBe('Schimb de ulei: adaugă kilometrajul');
  });

  it('says the English sentence', async () => {
    const out = await render((h) => h.next.set(null), 'en');
    expect(out.sentence).toBe('Oil service: add the reading');
  });

  it('is not a button when a value exists even if addable', async () => {
    const out = await render((h) => h.addable.set(true));
    expect(out.button).toBeNull();
  });

  it('ignores a date when no value is set', async () => {
    const out = await render((h) => {
      h.next.set(null);
      h.due.set('2026-10-09');
    });
    expect(out.state).toBe('grey');
  });
});
