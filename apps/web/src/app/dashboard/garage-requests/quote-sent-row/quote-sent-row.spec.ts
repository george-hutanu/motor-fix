import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { GarageRequestSummaryDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { QuoteSentRow } from './quote-sent-row';
import { quotedRow, requestRow } from '../garage-requests.testing';

@Component({
  imports: [QuoteSentRow],
  template: '<ul><li [mfQuoteSentRow]="row()" [now]="now()"></li></ul>',
})
class Host {
  readonly row = input.required<GarageRequestSummaryDto>();
  readonly now = input.required<Date>();
}

// 13:00 in Bucharest, a Friday.
const NOW = new Date('2026-10-09T10:00:00Z');

async function render(
  row: GarageRequestSummaryDto,
  language: 'ro' | 'en' = 'ro',
) {
  TestBed.configureTestingModule({});
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(Host);
  fixture.componentRef.setInput('row', row);
  fixture.componentRef.setInput('now', NOW);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).querySelector(
    'li',
  ) as HTMLElement;
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

const jobs = requestRow().jobs;
const sample = (slot: string, over: Partial<GarageRequestSummaryDto> = {}) =>
  quotedRow(
    {
      car: {
        brand: 'BMW',
        engine: null,
        fuel: 'diesel',
        model: 'X3',
        year: 2019,
      },
      driver: { shortName: 'Irina S.' },
      jobs: [
        {
          ...jobs[0],
          id: 'rj-1',
          nameEn: 'Rear brakes',
          nameRo: 'Frâne spate',
        },
        {
          ...jobs[0],
          id: 'rj-2',
          jobTypeId: 'job-oil',
          nameEn: 'Oil change',
          nameRo: 'Schimb ulei',
          position: 1,
        },
        {
          ...jobs[0],
          id: 'rj-3',
          jobTypeId: 'job-ac',
          nameEn: 'AC refill',
          nameRo: 'Încărcare freon',
          offered: false,
          position: 2,
        },
      ],
      ...over,
    },
    {
      fromBani: 65_000,
      jobs: [
        { included: true, requestJobId: 'rj-1' },
        { included: true, requestJobId: 'rj-2' },
        { included: false, requestJobId: 'rj-3' },
      ],
      slot,
      toBani: 80_000,
    },
  );

afterEach(() => TestBed.resetTestingModule());

// @traces 344-FR-014
// @traces 344-FR-017
describe('a row under Oferte trimise', () => {
  it('shows the driver, the car, the included jobs, the range, the slot and the waiting line', async () => {
    const row = await render(sample('2026-10-10T06:00:00Z'));

    expect(text(row.querySelector('.name'))).toBe('Irina S.');
    expect(text(row.querySelector('.car'))).toBe('BMW X3 · 2019');
    expect(text(row.querySelector('.jobs'))).toBe('Frâne spate · Schimb ulei');
    expect(text(row)).not.toContain('Încărcare freon');
    expect(text(row.querySelector('.range'))).toBe('650–800 lei');
    expect(text(row.querySelector('.slot'))).toBe('mâine, 09:00');
    expect(row.querySelector('.slot')?.getAttribute('datetime')).toBe(
      '2026-10-10T06:00:00Z',
    );
    expect(text(row.querySelector('.status'))).toBe(
      'Așteaptă răspunsul clientului',
    );
    expect(row.querySelector('.status .lamp')).not.toBeNull();
  });

  it('writes it in English for an English reader', async () => {
    const row = await render(sample('2026-10-10T06:00:00Z'), 'en');

    expect(text(row.querySelector('.jobs'))).toBe('Rear brakes · Oil change');
    expect(text(row.querySelector('.slot'))).toBe('tomorrow, 09:00');
    expect(text(row.querySelector('.status'))).toBe('Waiting for the customer');
  });

  it.each([
    ['2026-10-09T13:00:00Z', 'ro', 'azi, 16:00'],
    ['2026-10-09T13:00:00Z', 'en', 'today, 16:00'],
    ['2026-10-15T11:00:00Z', 'ro', 'joi, 15 oct., 14:00'],
    ['2026-10-15T11:00:00Z', 'en', 'Thu, 15 Oct, 14:00'],
  ] as const)(
    'words the slot %s in Bucharest time (%s) as %s',
    async (slot, language, said) => {
      const row = await render(sample(slot), language);

      expect(text(row.querySelector('.slot'))).toBe(said);
    },
  );

  it('shows the description’s first line when the request names no job', async () => {
    const row = await render(
      quotedRow(
        { descriptionLine: 'Scârțâie la frânare', jobs: [] },
        { jobs: [] },
      ),
    );

    expect(text(row.querySelector('.jobs'))).toBe('Scârțâie la frânare');
  });

  it('offers no action in this story', async () => {
    const row = await render(sample('2026-10-10T06:00:00Z'));

    expect(row.querySelector('button, a')).toBeNull();
  });
});

// @traces 222-FR-008
// @traces 222-FR-013
describe('a row whose quote the driver accepted', () => {
  const HOUR = 3_600_000;
  const PHONE = '+40722111222';
  const accepted = (
    confirmIn: number,
    driver: GarageRequestSummaryDto['driver'] = {
      phone: PHONE,
      shortName: 'Irina S.',
    },
  ) => {
    const base = sample('2026-10-10T06:00:00Z', {
      booking: {
        confirmBy: new Date(NOW.getTime() + confirmIn).toISOString(),
        status: 'awaiting_confirmation',
      },
      driver,
    });
    return {
      ...base,
      quote: base.quote && { ...base.quote, status: 'accepted' as const },
    };
  };

  it('says it waits for the garage’s confirmation, with the time left', async () => {
    const row = await render(accepted(5 * HOUR + 30 * 60_000));

    expect(text(row.querySelector('.status'))).toBe(
      'Acceptată · așteaptă confirmarea ta · încă 5 h',
    );
    expect(text(row)).not.toContain('Așteaptă răspunsul clientului');
    expect(row.classList).toContain('accepted');
  });

  it('writes it in English for an English reader', async () => {
    const row = await render(accepted(40 * 60_000), 'en');

    expect(text(row.querySelector('.status'))).toBe(
      'Accepted · waiting for your confirmation · 40 min left',
    );
  });

  it('says moments once the deadline is under a minute away', async () => {
    const row = await render(accepted(30_000));

    expect(text(row.querySelector('.status'))).toContain('încă câteva secunde');
  });

  it('keeps the name, the car, the jobs, the range and the slot', async () => {
    const row = await render(accepted(5 * HOUR));

    expect(text(row.querySelector('.name'))).toBe('Irina S.');
    expect(text(row.querySelector('.car'))).toBe('BMW X3 · 2019');
    expect(text(row.querySelector('.jobs'))).toBe('Frâne spate · Schimb ulei');
    expect(text(row.querySelector('.range'))).toBe('650–800 lei');
    expect(text(row.querySelector('.slot'))).toBe('mâine, 09:00');
  });

  it('links the driver’s phone for a call when the row carries it', async () => {
    const row = await render(accepted(5 * HOUR));

    const link = row.querySelector('a.phone');
    expect(link?.getAttribute('href')).toBe(`tel:${PHONE}`);
    expect(text(link)).toBe(PHONE);
    expect(link?.getAttribute('aria-label')).toBe(`Sună clientul: ${PHONE}`);
  });

  it('shows no phone when the row carries none', async () => {
    const row = await render(accepted(5 * HOUR, { shortName: 'Irina S.' }));

    expect(row.querySelector('a')).toBeNull();
  });

  it('reads as waiting when the booking no longer waits for the garage', async () => {
    const base = accepted(5 * HOUR);
    const row = await render({
      ...base,
      booking: base.booking && { ...base.booking, status: 'confirmed' },
    });

    expect(text(row.querySelector('.status'))).not.toContain('Acceptată');
    expect(row.classList).not.toContain('accepted');
  });

  it('gives the phone link a 44 px target and a green lamp', () => {
    const css = readFileSync(join(__dirname, 'quote-sent-row.css'), 'utf8');

    expect(css).toMatch(/\.phone \{[^}]*min-height: 44px/);
    expect(css).toMatch(
      /:host\(\.accepted\) \.lamp \{[^}]*background: var\(--mf-green\)/,
    );
  });
});

describe('type scale on a phone', () => {
  // @traces 975-type-scale-FR-003
  // @traces 975-type-scale-FR-008
  const stylesheet = readFileSync(
    join(__dirname, 'quote-sent-row.css'),
    'utf8',
  );
  const at = stylesheet.indexOf('@media (min-width: 768px)');
  const phone = at < 0 ? stylesheet : stylesheet.slice(0, at);
  const tablet = at < 0 ? '' : stylesheet.slice(at);

  it('sets no text under the body size on a phone', () => {
    expect(phone).not.toMatch(/font-size: var\(--mf-size-(small|label)\)/);
  });

  it('sets the car, the slot and the status small from a tablet up', () => {
    expect(tablet).toMatch(
      /\.car,\s*\.slot,\s*\.status \{\s*font-size: var\(--mf-size-small\);/,
    );
  });
});
