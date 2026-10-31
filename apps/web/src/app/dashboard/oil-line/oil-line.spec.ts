import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ChangeDetectorRef, Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { OilLine } from './oil-line';

@Component({
  imports: [OilLine],
  template: `<mf-oil-line
    [nextServiceKm]="next()"
    [odometerKm]="odometer()"
    [serviceDueOn]="dueOn()"
    [addable]="addable()"
    (add)="added = added + 1"
  />`,
})
class Host {
  readonly next = signal<number | null>(0);
  readonly odometer = signal(148200);
  readonly dueOn = signal<string | null>(null);
  readonly addable = signal(false);
  added = 0;
}

const styles = readFileSync(join(__dirname, 'oil-line.css'), 'utf8');

// Only Date is faked: Angular's stability checks still need real timers.
function clockAt(at: string) {
  jest.useFakeTimers({
    doNotFake: [
      'nextTick',
      'setImmediate',
      'clearImmediate',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'hrtime',
      'performance',
    ],
    now: new Date(at),
  });
}

function redraw(fixture: ComponentFixture<unknown>) {
  fixture.debugElement.injector.get(ChangeDetectorRef).markForCheck();
  fixture.detectChanges();
}

async function render(
  next: number | null,
  {
    addable = false,
    dueOn = null,
    language = 'ro',
  }: {
    addable?: boolean;
    dueOn?: string | null;
    language?: 'ro' | 'en';
  } = {},
) {
  const i18n = TestBed.inject(I18n);
  await i18n.enter('driver');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.next.set(next);
  fixture.componentInstance.dueOn.set(dueOn);
  fixture.componentInstance.addable.set(addable);
  fixture.detectChanges();
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const lamp = () => element.querySelector('mf-lamp') as HTMLElement;
  return {
    element,
    fixture,
    sentence: () => (lamp().textContent ?? '').replace(/\s+/g, ' ').trim(),
    state: () => lamp().getAttribute('data-state'),
  };
}

beforeEach(() => clockAt('2026-10-08T06:00:00Z'));
afterEach(() => {
  TestBed.resetTestingModule();
  jest.useRealTimers();
});

// @traces 029-FR-012
// @traces 1386-FR-003 1386-FR-006 1386-FR-008
describe('the oil-service line', () => {
  it.each([
    [
      3800,
      null,
      'green',
      'Schimb de ulei peste 3.800 km',
      'Oil service due in 3,800 km',
    ],
    [
      3800,
      '2026-12-07',
      'amber',
      'Schimb de ulei peste 3.800 km',
      'Oil service due in 3,800 km',
    ],
    [
      1500,
      '2026-11-23',
      'amber',
      'Schimb de ulei peste 1.500 km',
      'Oil service due in 1,500 km',
    ],
    [
      246,
      '2026-10-15',
      'red',
      'Schimb de ulei peste 246 km',
      'Oil service due in 246 km',
    ],
    [
      0,
      null,
      'red',
      'Schimbul de ulei este scadent acum',
      'Oil service is due now',
    ],
    [
      -200,
      null,
      'red',
      'Schimbul de ulei a trecut de 200 km',
      'Oil service overdue by 200 km',
    ],
    [
      -1500,
      null,
      'red',
      'Schimbul de ulei a trecut de 1.500 km',
      'Oil service overdue by 1,500 km',
    ],
  ])(
    'reads %i km left with a date of %p as a %s lamp',
    async (kmLeft, dueOn, state, ro, en) => {
      const romanian = await render(148200 + kmLeft, { dueOn });
      expect({
        sentence: romanian.sentence(),
        state: romanian.state(),
      }).toEqual({ sentence: ro, state });
      TestBed.resetTestingModule();

      const english = await render(148200 + kmLeft, { dueOn, language: 'en' });
      expect({ sentence: english.sentence(), state: english.state() }).toEqual({
        sentence: en,
        state,
      });
    },
  );

  it('judges the lamp again on every check, as the days pass', async () => {
    const line = await render(152000, { dueOn: '2026-12-08' });
    expect(line.state()).toBe('green');

    clockAt('2026-10-09T06:00:00Z');
    redraw(line.fixture);

    expect(line.state()).toBe('amber');
  });
});

// @traces 1386-FR-004 1386-FR-007 1386-FR-008
describe('the grey oil line that asks for the reading', () => {
  it('is a button reading the Romanian prompt that emits add', async () => {
    const line = await render(null, { addable: true });

    const button = line.element.querySelector('button');
    expect(button?.type).toBe('button');
    expect(button?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Schimb de ulei: adaugă kilometrajul',
    );
    expect(line.state()).toBe('grey');
    button?.click();
    expect(line.fixture.componentInstance.added).toBe(1);
  });

  it('names the button in English', async () => {
    const line = await render(null, { addable: true, language: 'en' });

    expect(
      line.element
        .querySelector('button')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim(),
    ).toBe('Oil service: add the reading');
  });

  it('is no button once the car has a value', async () => {
    const line = await render(152000, { addable: true });

    expect(line.element.querySelector('button')).toBeNull();
  });

  it('gives the button the 44 px target the stylesheet sets', () => {
    expect(styles).toMatch(/button\s*\{[^}]*min-height:\s*44px/);
  });
});
