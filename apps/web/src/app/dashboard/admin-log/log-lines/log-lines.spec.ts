import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { SystemLogEntryDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { LogLines } from './log-lines';
import { type LineView, lineView } from '../admin-log.line';

@Component({
  imports: [LogLines],
  template: '<mf-log-lines [lines]="lines()" />',
})
class Host {
  readonly lines = signal<LineView[]>([]);
}

const entry = (extra: Partial<SystemLogEntryDto> = {}): SystemLogEntryDto =>
  ({
    at: '2026-10-17T07:40:59.000Z',
    context: { version: 'v1' },
    count: 1,
    id: 'entry-1',
    kind: 'deploy',
    message: 'Deployed v1.',
    severity: 'info',
    source: 'worker',
    ...extra,
  }) as SystemLogEntryDto;

async function render(
  entries: SystemLogEntryDto[],
  language: 'ro' | 'en' = 'ro',
) {
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.lines.set(entries.map((e) => lineView(e, i18n)));
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

afterEach(() => TestBed.resetTestingModule());

// @traces 299-FR-012
describe('LogLines', () => {
  it('renders each entry as a list item with its time, lamp and word, and sentence', async () => {
    const element = await render([
      entry(),
      entry({
        at: '2026-10-16T21:05:00.000Z',
        context: { provider: 'brevo', status: 429 },
        id: 'entry-2',
        kind: 'service_error',
        severity: 'error',
        source: 'email',
      }),
    ]);

    const items = [...element.querySelectorAll('ol > li')];
    expect(items).toHaveLength(2);
    const time = items[0].querySelector('time') as HTMLTimeElement;
    expect(time.textContent?.trim()).toBe('10:40');
    expect(time.getAttribute('datetime')).toBe('2026-10-17T07:40:59.000Z');
    expect(items[0].querySelector('.text')?.textContent?.trim()).toBe(
      'Versiune nouă instalată: v1.',
    );
    const lamp = items[1].querySelector('mf-lamp');
    expect(lamp?.getAttribute('data-state')).toBe('red');
    expect(lamp?.textContent?.trim()).toBe('Eroare');
    expect(items[1].querySelector('time')?.textContent?.trim()).toBe('00:05');
    expect(items[1].querySelector('.text')?.textContent?.trim()).toBe(
      'Brevo a răspuns 429.',
    );
  });

  it('marks a grouped entry with its count, read out in words', async () => {
    const element = await render([
      entry({ count: 40 }),
      entry({ id: 'entry-2' }),
    ]);

    const [grouped, single] = [...element.querySelectorAll('ol > li')];
    expect(
      grouped.querySelector('.count [aria-hidden="true"]')?.textContent,
    ).toBe('×40');
    expect(grouped.querySelector('.count .sr-only')?.textContent?.trim()).toBe(
      'de 40 de ori',
    );
    expect(single.querySelector('.count')).toBeNull();
  });

  it('writes the lines in English', async () => {
    const element = await render([entry({ severity: 'warning' })], 'en');

    expect(element.querySelector('.text')?.textContent?.trim()).toBe(
      'Deployed v1.',
    );
    expect(element.querySelector('mf-lamp')?.textContent?.trim()).toBe(
      'Warning',
    );
  });

  it('shows the stored message when the line has no sentence for its context', async () => {
    const element = await render([
      entry({ context: {}, message: 'Deployed something.' }),
    ]);

    expect(element.querySelector('.text')?.textContent?.trim()).toBe(
      'Deployed something.',
    );
  });
});
