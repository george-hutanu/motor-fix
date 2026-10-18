import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { AdminLogFilters } from './admin-log-filters';
import type { LogFilter } from '../admin-log-view/narrowing';

@Component({
  imports: [AdminLogFilters],
  template: `<mf-admin-log-filters [filter]="filter()" (search)="searched.push($event)" (applied)="changed.push($event)" />`,
})
class Host {
  readonly filter = signal<LogFilter>({
    from: '2026-10-11',
    q: '',
    severity: null,
    source: null,
    to: '2026-10-17',
    type: null,
  });
  readonly searched: string[] = [];
  readonly changed: LogFilter[] = [];
}

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate', 'setTimeout'],
    now: new Date('2026-10-17T12:00:00.000Z'),
  });
  globalThis.matchMedia = (query: string) =>
    ({
      addEventListener() {},
      addListener() {},
      matches: false,
      media: query,
      removeEventListener() {},
      removeListener() {},
    }) as unknown as MediaQueryList;
});

afterEach(() => {
  jest.useRealTimers();
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

async function open(
  language: 'ro' | 'en' = 'ro',
  set: (host: Host) => void = () => {},
) {
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(Host);
  set(fixture.componentInstance);
  document.body.append(fixture.nativeElement);
  await settle();
  return {
    element: fixture.nativeElement as HTMLElement,
    host: fixture.componentInstance,
  };
}

const box = (el: HTMLElement) =>
  el.querySelector('input[type="search"]') as HTMLInputElement;
const select = (el: HTMLElement, name: string) =>
  el.querySelector(`select.${name}`) as HTMLSelectElement;
const date = (el: HTMLElement, name: 'from' | 'to') =>
  el.querySelector(`input.${name}`) as HTMLInputElement;
const choose = (
  control: HTMLSelectElement | HTMLInputElement,
  value: string,
) => {
  control.value = value;
  control.dispatchEvent(new Event('change', { bubbles: true }));
};
const labelOf = (el: HTMLElement, control: HTMLElement) =>
  el.querySelector(`label[for="${control.id}"]`)?.textContent?.trim();
const optionNames = (control: HTMLSelectElement) =>
  [...control.options].map((o) => o.textContent?.trim());
const filterButton = (el: HTMLElement) =>
  el.querySelector('button.filter') as HTMLButtonElement;
const described = (el: HTMLElement, control: HTMLElement) =>
  (control.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => el.querySelector(`#${id}`)?.textContent?.trim())
    .join(' ');

// @traces 299-FR-008
describe('the pickers', () => {
  it('offer every type by the name an admin uses, with all types first', async () => {
    const { element } = await open();

    const type = select(element, 'type');
    expect(labelOf(element, type)).toBe('Tip');
    expect(optionNames(type)).toEqual([
      'Toate tipurile',
      'Stare',
      'Verificări',
      'Joburi',
      'Servicii externe',
      'Erori de server',
      'Backup',
      'Deploy',
    ]);
  });

  it('name the types in English', async () => {
    const { element } = await open('en');

    expect(optionNames(select(element, 'type'))).toEqual([
      'All types',
      'Status',
      'Checks',
      'Jobs',
      'Outside services',
      'Server errors',
      'Backup',
      'Deploy',
    ]);
  });

  it('offer the three severities and the ten sources as Jurnal names them', async () => {
    const { element } = await open();

    expect(optionNames(select(element, 'severity'))).toEqual([
      'Toate gravitățile',
      'Info',
      'Avertisment',
      'Eroare',
    ]);
    const sources = optionNames(select(element, 'source'));
    expect(sources).toHaveLength(11);
    expect(sources[0]).toBe('Toate sursele');
    expect(sources).toEqual(
      expect.arrayContaining(['E‑mail', 'Hărți', 'Backup']),
    );
  });

  it('show the filter in force', async () => {
    const { element } = await open('ro', (host) =>
      host.filter.update((f) => ({
        ...f,
        severity: 'error',
        source: 'email',
        type: 'backup',
      })),
    );

    expect(select(element, 'type').value).toBe('backup');
    expect(select(element, 'severity').value).toBe('error');
    expect(select(element, 'source').value).toBe('email');
  });

  it('emit each choice at once, keeping the rest; the all option is no filter', async () => {
    const { element, host } = await open();

    choose(select(element, 'type'), 'backup');
    await settle();
    choose(select(element, 'severity'), 'error');
    await settle();
    choose(select(element, 'severity'), '');
    await settle();

    expect(host.changed.map((f) => [f.type, f.severity])).toEqual([
      ['backup', null],
      ['backup', 'error'],
      ['backup', null],
    ]);
  });
});

// @traces 299-FR-008 299-FR-010
describe('the dates', () => {
  it('are two labelled date inputs from ninety days ago to today', async () => {
    const { element } = await open();

    const from = date(element, 'from');
    const to = date(element, 'to');
    expect([from.type, to.type]).toEqual(['date', 'date']);
    expect([labelOf(element, from), labelOf(element, to)]).toEqual([
      'De la',
      'Până la',
    ]);
    expect([from.min, from.max, to.max]).toEqual([
      '2026-07-19',
      '2026-10-17',
      '2026-10-17',
    ]);
    expect([from.value, to.value]).toEqual(['2026-10-11', '2026-10-17']);
  });

  it('emit a range the inputs allow', async () => {
    const { element, host } = await open();

    choose(date(element, 'from'), '2026-10-01');
    await settle();

    expect(host.changed.at(-1)).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-17',
    });
  });

  it('send no end before the start, and say so on the end input', async () => {
    const { element, host } = await open();

    choose(date(element, 'to'), '2026-10-05');
    await settle();

    expect(host.changed).toEqual([]);
    const to = date(element, 'to');
    expect(to.getAttribute('aria-invalid')).toBe('true');
    expect(described(element, to)).toBe(
      '„Până la” nu poate fi înainte de „De la”.',
    );
    expect(date(element, 'from').getAttribute('aria-invalid')).toBeNull();
  });

  it('send no day after today, and say so on the input at fault in English', async () => {
    const { element, host } = await open('en');

    choose(date(element, 'from'), '2026-10-18');
    await settle();

    expect(host.changed).toEqual([]);
    expect(described(element, date(element, 'from'))).toBe(
      'Pick a day up to today.',
    );
  });

  it('send no day older than ninety days', async () => {
    const { element, host } = await open();

    choose(date(element, 'from'), '2026-07-18');
    await settle();

    expect(host.changed).toEqual([]);
    expect(described(element, date(element, 'from'))).toBe(
      'Jurnalul păstrează doar ultimele 90 de zile.',
    );
  });

  it('clear the fault once the range is right again', async () => {
    const { element, host } = await open();

    choose(date(element, 'to'), '2026-10-05');
    await settle();
    choose(date(element, 'from'), '2026-10-01');
    await settle();

    expect(host.changed.at(-1)).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-05',
    });
    expect(date(element, 'to').getAttribute('aria-invalid')).toBeNull();
    expect(described(element, date(element, 'to'))).toBe('');
  });
});

// @traces 299-FR-008 299-FR-015
describe("the phone's filter button", () => {
  it('says how many filters are set', async () => {
    const { element } = await open('ro', (host) =>
      host.filter.update((f) => ({
        ...f,
        from: '2026-10-01',
        severity: 'error',
        type: 'backup',
      })),
    );

    expect(filterButton(element).textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Filtre 3',
    );
    expect(filterButton(element).getAttribute('aria-label')).toBe(
      'Filtre, 3 setate',
    );
  });

  it('shows no count when nothing is set', async () => {
    const { element } = await open('en');

    expect(filterButton(element).textContent?.trim()).toBe('Filters');
    expect(filterButton(element).getAttribute('aria-label')).toBe('Filters');
  });

  it('opens the sheet and emits what it applies, keeping the search', async () => {
    const { element, host } = await open('ro', (host) =>
      host.filter.update((f) => ({ ...f, q: 'brevo' })),
    );

    filterButton(element).click();
    await settle();
    const sheet = document.querySelector(
      'mf-admin-log-filters-sheet',
    ) as HTMLElement;
    choose(sheet.querySelector('select.type') as HTMLSelectElement, 'jobs');
    await settle();
    (
      [...sheet.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Aplică',
      ) as HTMLButtonElement
    ).click();
    await settle();

    expect(host.changed).toEqual([
      {
        from: '2026-10-11',
        q: 'brevo',
        severity: null,
        source: null,
        to: '2026-10-17',
        type: 'jobs',
      },
    ]);
  });
});

// @traces 299-FR-011
describe('the search box', () => {
  it('is a search field named "Caută în jurnal"', async () => {
    const { element } = await open();

    expect(box(element).getAttribute('aria-label')).toBe('Caută în jurnal');
    expect(box(element).closest('[role="search"]')).not.toBeNull();
  });

  it('is named "Search the log" in English', async () => {
    const { element } = await open('en');

    expect(box(element).getAttribute('aria-label')).toBe('Search the log');
  });

  it('commits the trimmed text 300 ms after the last key, once', async () => {
    const { element, host } = await open();

    const input = box(element);
    input.value = 'bre';
    input.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 150));
    input.value = '  brevo ';
    input.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(host.searched).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(host.searched).toEqual(['brevo']);
  });

  it('cuts the text at 100 characters', async () => {
    const { element, host } = await open();

    const input = box(element);
    input.value = 'a'.repeat(130);
    input.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(host.searched).toEqual(['a'.repeat(100)]);
    expect(input.getAttribute('maxlength')).toBe('100');
  });

  it('shows the search from the address', async () => {
    const { element } = await open('ro', (host) =>
      host.filter.update((f) => ({ ...f, q: 'brevo' })),
    );

    expect(box(element).value).toBe('brevo');
  });
});
