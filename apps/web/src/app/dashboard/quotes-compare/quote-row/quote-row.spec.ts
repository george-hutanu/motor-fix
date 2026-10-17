import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CompareQuoteDto } from '@motor-fix/data-access';
import { I18n, relativeTime } from '@motor-fix/i18n';

import { QuoteRow } from './quote-row';
import type { RowState } from '../compare-rules/compare-rules';

@Component({
  imports: [QuoteRow],
  template: `<ul>
    <li
      [mfQuoteRow]="quote()"
      [state]="state()"
      [now]="now"
      [busy]="busy()"
      [locked]="locked()"
      [problem]="problem()"
      (accept)="accepted.push($event)"
    ></li>
  </ul>`,
})
class Host {
  readonly quote = input.required<CompareQuoteDto>();
  readonly state = input<RowState>('open');
  readonly busy = input(false);
  readonly locked = input(false);
  readonly problem = input<string | null>(null);
  readonly now = NOW;
  readonly accepted: string[] = [];
}

// 13:00 in Bucharest, a Friday.
const NOW = new Date('2026-10-09T10:00:00Z');

const quote = (over: Partial<CompareQuoteDto> = {}): CompareQuoteDto => ({
  changedAt: null,
  durationMinutes: 90,
  expiresAt: '2026-10-16T10:00:00.000Z',
  fromBani: 89_000,
  garage: {
    area: 'București',
    id: 'g-1',
    mobile: false,
    name: 'Atelier Dinamo',
    rating: 4.7,
    reviewCount: 31,
    slug: 'atelier-dinamo',
  },
  id: 'q-1',
  jobs: [
    {
      included: true,
      nameEn: 'Oil change',
      nameRo: 'Schimb ulei',
      requestJobId: 'rj-1',
    },
    {
      included: true,
      nameEn: 'AC refill',
      nameRo: 'Încărcare freon',
      requestJobId: 'rj-2',
    },
  ],
  note: null,
  sentAt: '2026-10-09T08:00:00.000Z',
  // 09:00 in Bucharest, the next day.
  slot: '2026-10-10T06:00:00.000Z',
  status: 'waiting',
  toBani: 140_000,
  ...over,
});

interface Setup {
  state?: RowState;
  busy?: boolean;
  locked?: boolean;
  problem?: string | null;
  language?: 'ro' | 'en';
}

async function render(
  value: CompareQuoteDto,
  { language = 'ro', ...inputs }: Setup = {},
) {
  TestBed.configureTestingModule({});
  await TestBed.inject(I18n).enter('driver');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(Host);
  fixture.componentRef.setInput('quote', value);
  for (const [name, v] of Object.entries(inputs)) {
    fixture.componentRef.setInput(name, v);
  }
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const row = (fixture.nativeElement as HTMLElement).querySelector(
    'li',
  ) as HTMLElement;
  return { host: fixture.componentInstance, row };
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const part = (row: HTMLElement, name: string) =>
  row.querySelector<HTMLElement>(`[data-part="${name}"]`);
const button = (row: HTMLElement) => row.querySelector('button');

afterEach(() => TestBed.resetTestingModule());

// @traces 313-FR-006
describe('a quote row', () => {
  it('shows the same five things in order: name, where, rating, price, action', async () => {
    const { row } = await render(quote());

    const parts = [...row.querySelectorAll<HTMLElement>('[data-part]')]
      .map((p) => p.dataset['part'])
      .filter((p) =>
        ['name', 'where', 'rating', 'price', 'action'].includes(p ?? ''),
      );
    expect(parts).toEqual(['name', 'where', 'rating', 'price', 'action']);
    expect(text(part(row, 'name'))).toBe('Atelier Dinamo');
  });

  it('gives the city and the first free slot in Bucharest time', async () => {
    const { row } = await render(quote());

    expect(text(part(row, 'where'))).toBe('București · liber mâine, 09:00');
  });

  it('says it in English for an English reader', async () => {
    const { row } = await render(quote(), { language: 'en' });

    expect(text(part(row, 'where'))).toBe('București · free tomorrow, 09:00');
  });

  it.each([
    ['2026-10-09T13:00:00Z', 'ro', 'azi, 16:00'],
    ['2026-10-09T13:00:00Z', 'en', 'today, 16:00'],
    ['2026-10-15T11:00:00Z', 'ro', 'joi, 15 oct., 14:00'],
    ['2026-10-15T11:00:00Z', 'en', 'Thu, 15 Oct, 14:00'],
  ] as const)(
    'reads a slot at %s in %s as %s',
    async (slot, language, when) => {
      const { row } = await render(quote({ slot }), { language });

      expect(text(part(row, 'where'))).toContain(when);
    },
  );

  it('names a mobile mechanic in place of the city', async () => {
    const mobile = { ...quote().garage, area: null, mobile: true };

    expect(
      text(part((await render(quote({ garage: mobile }))).row, 'where')),
    ).toBe('Mecanic mobil · liber mâine, 09:00');
    TestBed.resetTestingModule();
    expect(
      text(
        part(
          (await render(quote({ garage: mobile }), { language: 'en' })).row,
          'where',
        ),
      ),
    ).toBe('Mobile mechanic · free tomorrow, 09:00');
  });

  it('shows the slot alone when the city is unknown', async () => {
    const { row } = await render(
      quote({ garage: { ...quote().garage, area: null } }),
    );

    expect(text(part(row, 'where'))).toBe('liber mâine, 09:00');
  });

  it('writes the rating with one decimal and the language’s mark', async () => {
    expect(text(part((await render(quote())).row, 'rating'))).toBe('4,7');
    TestBed.resetTestingModule();
    expect(
      text(part((await render(quote(), { language: 'en' })).row, 'rating')),
    ).toBe('4.7');
  });

  it('says a garage with no review has none yet', async () => {
    const unrated = { ...quote().garage, rating: null, reviewCount: 0 };

    expect(
      text(part((await render(quote({ garage: unrated }))).row, 'rating')),
    ).toBe('fără recenzii');
    TestBed.resetTestingModule();
    expect(
      text(
        part(
          (await render(quote({ garage: unrated }), { language: 'en' })).row,
          'rating',
        ),
      ),
    ).toBe('no reviews yet');
  });

  it('writes the range in lei with the Romanian thousands mark', async () => {
    const { row } = await render(quote());

    expect(text(part(row, 'price'))).toBe('890–1.400 lei');
  });

  it('writes one amount when both ends are equal', async () => {
    const { row } = await render(quote({ fromBani: 89_000, toBani: 89_000 }));

    expect(text(part(row, 'price'))).toBe('890 lei');
  });

  it.each([
    [45, 'ro', 'aprox. 45 min'],
    [60, 'ro', 'aprox. 1 h'],
    [90, 'ro', 'aprox. 1 h 30'],
    [90, 'en', 'about 1 h 30'],
  ] as const)(
    'gives a %i-minute job as %s %s',
    async (durationMinutes, language, words) => {
      const { row } = await render(quote({ durationMinutes }), { language });

      expect(text(part(row, 'duration'))).toBe(words);
    },
  );

  it('shows the garage’s note as plain text', async () => {
    const { row } = await render(quote({ note: 'Piese <b>originale</b>' }));

    expect(text(part(row, 'note'))).toBe('Piese <b>originale</b>');
    expect(part(row, 'note')?.querySelector('b')).toBeNull();
  });

  it('leaves the note out when there is none', async () => {
    const { row } = await render(quote());

    expect(part(row, 'note')).toBeNull();
  });

  it('names the jobs the quote leaves out', async () => {
    const jobs = quote().jobs.map((j) => ({ ...j, included: false }));

    expect(text(part((await render(quote({ jobs }))).row, 'missing'))).toBe(
      'Nu face: Schimb ulei, Încărcare freon',
    );
    TestBed.resetTestingModule();
    expect(
      text(
        part(
          (await render(quote({ jobs }), { language: 'en' })).row,
          'missing',
        ),
      ),
    ).toBe('Does not do: Oil change, AC refill');
  });

  it('says nothing is left out when the quote covers every job', async () => {
    const { row } = await render(quote());

    expect(part(row, 'missing')).toBeNull();
  });

  it('says when a quote was changed', async () => {
    const changedAt = '2026-10-09T09:50:00.000Z';

    expect(
      text(part((await render(quote({ changedAt }))).row, 'changed')),
    ).toBe(`Modificată ${relativeTime(changedAt, 'ro', NOW)}`);
    TestBed.resetTestingModule();
    expect(
      text(
        part(
          (await render(quote({ changedAt }), { language: 'en' })).row,
          'changed',
        ),
      ),
    ).toBe(`Changed ${relativeTime(changedAt, 'en', NOW)}`);
  });

  it('says nothing about a change for a quote never changed', async () => {
    const { row } = await render(quote());

    expect(part(row, 'changed')).toBeNull();
  });
});

// @traces 313-FR-007
describe('a quote row’s status', () => {
  it('holds Acceptă for an open quote', async () => {
    const { row } = await render(quote());

    expect(text(button(row))).toBe('Acceptă');
    expect(row.classList).not.toContain('greyed');
  });

  it.each([
    ['expired', 'Expirată', 'Expired', true],
    ['declined', 'Refuzată de tine', 'Declined by you', true],
    ['closed', 'Închisă', 'Closed', true],
    ['accepted', 'Acceptată', 'Accepted', false],
    ['on_hold', 'În așteptare', 'On hold', false],
  ] as const)(
    'reads %s as "%s" with no action',
    async (state, ro, en, greyed) => {
      const { row } = await render(quote(), { state });

      expect(button(row)).toBeNull();
      expect(text(part(row, 'action'))).toBe(ro);
      expect(row.classList.contains('greyed')).toBe(greyed);
      TestBed.resetTestingModule();
      expect(
        text(
          part(
            (await render(quote(), { language: 'en', state })).row,
            'action',
          ),
        ),
      ).toBe(en);
    },
  );
});

// @traces 313-FR-008
describe('accepting from a row', () => {
  it('asks to accept its quote on Acceptă', async () => {
    const { host, row } = await render(quote({ id: 'q-7' }));

    button(row)?.click();

    expect(host.accepted).toEqual(['q-7']);
  });

  it('shows the busy button while the accept is in flight', async () => {
    const { host, row } = await render(quote(), { busy: true });

    expect(button(row)?.getAttribute('aria-busy')).toBe('true');
    expect(button(row)?.disabled).toBe(true);
    button(row)?.click();
    expect(host.accepted).toEqual([]);
  });

  it('disables Acceptă while another accept is in flight or the driver is offline', async () => {
    const { row } = await render(quote(), { locked: true });

    expect(button(row)?.disabled).toBe(true);
    expect(button(row)?.getAttribute('aria-busy')).not.toBe('true');
  });

  it('shows the server’s refusal under the row and keeps Acceptă', async () => {
    const { row } = await render(quote(), { problem: 'Oferta a expirat.' });

    expect(text(part(row, 'problem'))).toBe('Oferta a expirat.');
    expect(text(button(row))).toBe('Acceptă');
  });
});
