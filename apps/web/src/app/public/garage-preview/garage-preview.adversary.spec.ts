import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type {
  DetailsSection,
  MechanicsSection,
  PricesSection,
} from '@motor-fix/contracts/listing-sections';
import { I18n } from '@motor-fix/i18n';

import { GaragePreview } from './garage-preview';
import { previewCard } from './preview-card';
import type { BrandsSection, MarkedBrand } from '../brands-section';

const mark = (
  brandId: string,
  name: string,
  stance: MarkedBrand['stance'],
): MarkedBrand => ({ brandId, name, stance });

const base = {
  brands: { brands: [] } as BrandsSection,
  details: {} as DetailsSection,
  mechanics: {} as MechanicsSection,
  order: [] as string[],
  prices: undefined as PricesSection | undefined,
};

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function render(inputs: Partial<typeof base> = {}) {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  await TestBed.inject(I18n).enter('public');
  const fixture = TestBed.createComponent(GaragePreview);
  for (const [key, value] of Object.entries({ ...base, ...inputs })) {
    fixture.componentRef.setInput(key, value);
  }
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
  return fixture.nativeElement as HTMLElement;
}

describe('previewCard under hostile input', () => {
  it('returns the empty card for an empty draft', () => {
    expect(previewCard(base)).toMatchObject({
      mechanics: [],
      mobileKm: null,
      name: null,
      range: null,
      sample: null,
    });
  });

  it('treats a zero lower bound as a typed value', () => {
    const card = previewCard({
      ...base,
      prices: { labour: { fromBani: 0, toBani: 20000 } },
    });
    expect(card.range).toEqual({ from: 0, to: 200 });
  });

  it('shows a zero upper bound with a missing lower bound', () => {
    const card = previewCard({ ...base, prices: { labour: { toBani: 0 } } });
    expect(card.range).toEqual({ from: null, to: 0 });
  });

  it('returns no range for an empty labour object', () => {
    expect(previewCard({ ...base, prices: { labour: {} } }).range).toBeNull();
  });

  it('trims the name and treats whitespace and tabs as blank', () => {
    expect(
      previewCard({ ...base, details: { name: '\t \n' } }).name,
    ).toBeNull();
    expect(previewCard({ ...base, details: { name: '  Dinamo ' } }).name).toBe(
      'Dinamo',
    );
  });

  it('never carries the phone, knownFor or speciality anywhere in the card', () => {
    const card = previewCard({
      ...base,
      details: {
        businessKind: 'mobile',
        knownFor: 'Strada Secretă 7',
        mobileLegalForm: 'pfa',
        name: 'Atelier',
        phone: '+40712345678',
      },
      mechanics: {
        mechanics: [{ name: 'Ana Pop', speciality: 'Ascunsă' }],
        onProfile: true,
      },
    });
    const json = JSON.stringify(card);
    expect(json).not.toContain('40712345678');
    expect(json).not.toContain('Secretă');
    expect(json).not.toContain('Ascunsă');
  });

  it('exposes only the closed set of card fields', () => {
    expect(Object.keys(previewCard(base)).sort()).toEqual([
      'brands',
      'mechanics',
      'mobileKm',
      'name',
      'range',
      'sample',
    ]);
  });

  it('does not change its input and gives the same card twice', () => {
    const input = {
      ...base,
      brands: {
        brands: [
          mark('b', 'B', 'works_on'),
          mark('a', 'A', 'does_not_take'),
          mark('c', 'C', 'works_on'),
        ],
      },
      order: ['c', 'b', 'a'],
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    const first = previewCard(input);
    expect(previewCard(input)).toEqual(first);
    expect(input).toEqual(snapshot);
  });

  it('picks the first taken brand in display order, not the draft order', () => {
    const card = previewCard({
      ...base,
      brands: {
        brands: [
          mark('dacia', 'Dacia', 'works_on'),
          mark('tesla', 'Tesla', 'does_not_take'),
          mark('bmw', 'BMW', 'works_on'),
        ],
      },
      order: ['tesla', 'bmw', 'dacia'],
    });
    expect(card.sample).toEqual({ id: 'bmw', name: 'BMW' });
  });

  it('keeps draft order when the order list is empty', () => {
    const card = previewCard({
      ...base,
      brands: {
        brands: [mark('z', 'Zeta', 'works_on'), mark('a', 'Alfa', 'works_on')],
      },
    });
    expect(card.sample?.name).toBe('Zeta');
  });

  it('puts brands missing from the order after the ones in it', () => {
    const card = previewCard({
      ...base,
      brands: {
        brands: [mark('x', 'X', 'works_on'), mark('y', 'Y', 'works_on')],
      },
      order: ['y'],
    });
    expect(card.sample?.name).toBe('Y');
  });

  it('has no sample when every brand is refused', () => {
    const card = previewCard({
      ...base,
      brands: { brands: [mark('t', 'Tesla', 'does_not_take')] },
      order: ['t'],
    });
    expect(card.sample).toBeNull();
  });

  it('shows the refusal phrase only when it has visible text', () => {
    const card = previewCard({
      ...base,
      brands: {
        brands: [mark('t', 'Tesla', 'does_not_take')],
        refusalPhrase: '   ',
      },
    });
    expect(card.brands?.refusalPhrase ?? null).toBeNull();
    expect(card.brands?.doesNotTake.map((b) => b.name)).toEqual(['Tesla']);
  });

  it('lists a brand once when the draft repeats its id', () => {
    const card = previewCard({
      ...base,
      brands: {
        brands: [mark('b', 'BMW', 'works_on'), mark('b', 'BMW', 'works_on')],
      },
      order: ['b'],
    });
    expect(card.brands?.worksOn.map((b) => b.name)).toEqual(['BMW']);
  });

  it('handles ten thousand brands and keeps the order stable', () => {
    const brands = Array.from({ length: 10000 }, (_, i) =>
      mark(`id-${i}`, `Brand ${i}`, i % 2 ? 'works_on' : 'does_not_take'),
    );
    const started = Date.now();
    const card = previewCard({
      ...base,
      brands: { brands },
      order: brands.map((b) => b.brandId).reverse(),
    });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(card.brands?.worksOn).toHaveLength(5000);
    expect(card.sample?.id).toBe('id-9999');
  });

  it.each([
    ['Ana', 'A'],
    ['  Mihai   Dumitru  ', 'MD'],
    ['Ștefan Țurcanu', 'ȘȚ'],
    ['ion', 'I'],
  ])('derives initials for %j', (name, expected) => {
    const card = previewCard({
      ...base,
      mechanics: { mechanics: [{ name }], onProfile: true },
    });
    expect(card.mechanics).toEqual([{ initials: expected, name: name.trim() }]);
  });

  it('shows no mechanic when the switch is off or missing', () => {
    const mechanics = [{ name: 'Ana Pop' }];
    expect(
      previewCard({ ...base, mechanics: { mechanics } }).mechanics,
    ).toEqual([]);
    expect(
      previewCard({ ...base, mechanics: { mechanics, onProfile: false } })
        .mechanics,
    ).toEqual([]);
  });

  it('skips a mechanic whose name is blank', () => {
    const card = previewCard({
      ...base,
      mechanics: { mechanics: [{ name: '   ' }], onProfile: true },
    });
    expect(card.mechanics).toEqual([]);
  });

  it('sets the service area for a mobile business only', () => {
    expect(
      previewCard({ ...base, details: { businessKind: 'mobile' } }).mobileKm,
    ).toBe(20);
    for (const kind of ['company', 'pfa', 'ii'] as const) {
      expect(
        previewCard({ ...base, details: { businessKind: kind } }).mobileKm,
      ).toBeNull();
    }
  });

  it('survives null where undefined was expected', () => {
    const hostile = {
      brands: { brandNote: null, brands: [], refusalPhrase: null },
      details: { name: null, phone: null },
      mechanics: { mechanics: [], onProfile: true },
      order: [],
      prices: { labour: { fromBani: null, toBani: null } },
    } as unknown as typeof base;
    expect(previewCard(hostile)).toMatchObject({ name: null, range: null });
  });
});

describe('the garage preview under hostile input', () => {
  it('draws markup in a name as plain text', async () => {
    const host = await render({
      details: { name: '<img src=x onerror=alert(1)><b>Bold</b>' },
    });
    expect(host.querySelector('.name img')).toBeNull();
    expect(host.querySelector('.name b')).toBeNull();
    expect(text(host.querySelector('.name'))).toBe(
      '<img src=x onerror=alert(1)><b>Bold</b>',
    );
  });

  it('draws markup in a brand name and a mechanic name as plain text', async () => {
    const host = await render({
      brands: { brands: [mark('x', '<i>Evil</i>', 'works_on')] },
      mechanics: {
        mechanics: [{ name: '<u>Ion</u> Pop' }],
        onProfile: true,
      },
      order: ['x'],
    });
    expect(host.querySelector('i')).toBeNull();
    expect(host.querySelector('u')).toBeNull();
  });

  it('shows a zero lower bound as 0', async () => {
    const host = await render({
      prices: { labour: { fromBani: 0, toBani: 20000 } },
    });
    expect(text(host.querySelector('.range'))).toBe('0–200 lei/oră');
  });

  it('shows the whole range placeholder for an empty labour object', async () => {
    const host = await render({ prices: { labour: {} } });
    expect(text(host.querySelector('.range'))).toBe('Manopera: — lei/oră');
  });

  it('shows no mechanic rows for an on switch with no mechanics', async () => {
    const host = await render({
      mechanics: { mechanics: [], onProfile: true },
    });
    expect(host.querySelectorAll('.mechanic')).toHaveLength(0);
  });

  it('shows every one of fifty mechanics once', async () => {
    const mechanics = Array.from({ length: 50 }, (_, i) => ({
      name: `Mecanic${i} Nume`,
    }));
    const host = await render({ mechanics: { mechanics, onProfile: true } });
    expect(host.querySelectorAll('.mechanic')).toHaveLength(50);
  });

  it('keeps a phone number typed as the garage name out of nothing but the name', async () => {
    const host = await render({
      details: { name: 'Service', phone: '0712 345 678' },
    });
    expect(host.textContent).not.toContain('0712 345 678');
    expect(host.textContent).not.toContain('712');
  });

  it('keeps the brand note off the card', async () => {
    const host = await render({
      brands: {
        brandNote: 'Notă privată despre mărci',
        brands: [mark('x', 'BMW', 'works_on')],
      },
      order: ['x'],
    });
    expect(host.textContent).not.toContain('Notă privată');
  });

  it('keeps the specialist phrase off the taken list', async () => {
    const host = await render({
      brands: {
        brands: [mark('x', 'BMW', 'works_on')],
        refusalPhrase: 'orice nu e BMW',
      },
      order: ['x'],
    });
    const lines = [...host.querySelectorAll('.line')].map(text);
    expect(lines).toEqual(['Lucrează pe: BMW', 'Nu primește: orice nu e BMW']);
  });

  it('renders ten thousand characters of name inside the card', async () => {
    const host = await render({ details: { name: 'A'.repeat(10000) } });
    expect(text(host.querySelector('.name'))).toHaveLength(10000);
  });
});
