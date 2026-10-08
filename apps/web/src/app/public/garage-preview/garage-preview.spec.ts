import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type {
  DetailsSection,
  MechanicsSection,
  PricesSection,
} from '@motor-fix/contracts/listing-sections';
import { I18n } from '@motor-fix/i18n';

import { GaragePreview } from './garage-preview';
import { BrandVerdict } from '../brand-verdict';
import type { BrandsSection, MarkedBrand } from '../brands-section';

const BMW = 'b-bmw';
const DACIA = 'b-dacia';
const TESLA = 'b-tesla';
const ORDER = [BMW, DACIA, TESLA];

const mark = (
  brandId: string,
  name: string,
  stance: MarkedBrand['stance'],
): MarkedBrand => ({ brandId, name, stance });

type Inputs = {
  brands?: BrandsSection;
  details?: DetailsSection;
  mechanics?: MechanicsSection;
  order?: string[];
  prices?: PricesSection;
};

async function settle(fixture: {
  detectChanges(): void;
  whenStable(): Promise<unknown>;
}) {
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
}

async function render(inputs: Inputs = {}, language: 'ro' | 'en' = 'ro') {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(GaragePreview);
  const set = async (next: Inputs) => {
    for (const [key, value] of Object.entries(next)) {
      fixture.componentRef.setInput(key, value);
    }
    await settle(fixture);
  };
  await set({
    brands: { brands: [] },
    details: {},
    mechanics: {},
    order: ORDER,
    prices: undefined,
    ...inputs,
  });
  const host = fixture.nativeElement as HTMLElement;
  return { fixture, host, set };
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const lamps = (host: HTMLElement) => [...host.querySelectorAll('mf-lamp')];
const lines = (host: HTMLElement) =>
  [...host.querySelectorAll('.line')].map(text);
const toggle = (host: HTMLElement) =>
  host.querySelector<HTMLButtonElement>('button[aria-expanded]');

describe('the garage preview', () => {
  it('shows the title, both placeholders and the draft state on an empty form', async () => {
    const { host } = await render();

    expect(text(host.querySelector('.title'))).toBe('Cum îl vor vedea șoferii');
    expect(text(host.querySelector('.name'))).toBe('Numele service‑ului');
    expect(text(host.querySelector('.range'))).toBe('Manopera: — lei/oră');
    expect(text(host.querySelector('.state'))).toBe(
      'Ciornă · se publică după verificare',
    );
  });

  it('follows the name and the labour range as they change, and returns to the placeholder when the name is cleared', async () => {
    const { host, set } = await render();

    await set({
      details: { name: 'Service Ionescu' },
      prices: { labour: { fromBani: 15000, toBani: 25000 } },
    });
    expect(text(host.querySelector('.name'))).toBe('Service Ionescu');
    expect(text(host.querySelector('.range'))).toBe('150–250 lei/oră');

    await set({ details: { name: '  ' } });
    expect(text(host.querySelector('.name'))).toBe('Numele service‑ului');
  });

  it('shows "…" for a missing end of the range', async () => {
    const { host, set } = await render({
      prices: { labour: { fromBani: 15000 } },
    });
    expect(text(host.querySelector('.range'))).toBe('150–… lei/oră');

    await set({ prices: { labour: { toBani: 25000 } } });
    expect(text(host.querySelector('.range'))).toBe('…–250 lei/oră');
  });

  it('speaks English', async () => {
    const { host } = await render(
      { prices: { labour: { fromBani: 15000, toBani: 25000 } } },
      'en',
    );

    expect(text(host.querySelector('.title'))).toBe('How drivers will see it');
    expect(text(host.querySelector('.name'))).toBe("Your garage's name");
    expect(text(host.querySelector('.range'))).toBe('150–250 lei/hour');
    expect(text(host.querySelector('.state'))).toBe(
      'Draft · published after verification',
    );
    expect(text(toggle(host))).toBe('Preview');
  });

  it('asks nothing of the server', async () => {
    await render({
      brands: { brands: [mark(BMW, 'BMW', 'works_on')] },
      details: { name: 'Service' },
    });

    TestBed.inject(HttpTestingController).verify();
  });
});

describe('the brands on the preview', () => {
  const marked: BrandsSection = {
    brands: [
      mark(DACIA, 'Dacia', 'works_on'),
      mark(TESLA, 'Tesla', 'does_not_take'),
      mark(BMW, 'BMW', 'works_on'),
    ],
  };

  it('lights the lamp green on the first taken brand and lists both stances', async () => {
    const { host } = await render({ brands: marked });

    const [lamp] = lamps(host);
    expect(lamps(host)).toHaveLength(1);
    expect(lamp?.getAttribute('data-state')).toBe('green');
    expect(text(lamp)).toBe('Lucrează pe BMW');
    expect(lines(host)).toEqual([
      'Lucrează pe: BMW, Dacia',
      'Nu primește: Tesla',
    ]);
  });

  it('draws the lamp and the lists exactly as drivers see them', async () => {
    const { host } = await render({ brands: marked });
    const preview = host.querySelector('mf-brand-verdict');

    const driver = TestBed.createComponent(BrandVerdict);
    driver.componentRef.setInput('answer', {
      brandNote: null,
      doesNotTake: [{ id: TESLA, name: 'Tesla', slug: 'tesla' }],
      refusalPhrase: null,
      worksOn: [
        { id: BMW, name: 'BMW', slug: 'bmw' },
        { id: DACIA, name: 'Dacia', slug: 'dacia' },
      ],
    });
    driver.componentRef.setInput('brand', { id: BMW, name: 'BMW' });
    await settle(driver);

    expect(preview?.innerHTML).toBe(
      (driver.nativeElement as HTMLElement).innerHTML,
    );
  });

  it('shows a grey lamp and "nimic ales încă" in both lists when no brand is marked', async () => {
    const { host } = await render();

    const [lamp] = lamps(host);
    expect(lamps(host)).toHaveLength(1);
    expect(lamp?.getAttribute('data-state')).toBe('grey');
    expect(text(lamp)).toBe('Nicio marcă aleasă');
    expect(lines(host)).toEqual([
      'Lucrează pe: nimic ales încă',
      'Nu primește: nimic ales încă',
    ]);
  });

  it('keeps the lamp grey and the taken list empty when brands are only refused', async () => {
    const { host } = await render({
      brands: { brands: [mark(TESLA, 'Tesla', 'does_not_take')] },
    });

    expect(lamps(host).map((l) => l.getAttribute('data-state'))).toEqual([
      'grey',
    ]);
    expect(text(lamps(host)[0])).toBe('Nicio marcă aleasă');
    expect(lines(host)).toEqual([
      'Lucrează pe: nimic ales încă',
      'Nu primește: Tesla',
    ]);
  });

  it('says "nimic ales încă" for refusals when only taken brands are marked', async () => {
    const { host } = await render({
      brands: { brands: [mark(BMW, 'BMW', 'works_on')] },
    });

    expect(lines(host)).toEqual([
      'Lucrează pe: BMW',
      'Nu primește: nimic ales încă',
    ]);
  });

  it('shows the specialist phrase in place of the refused brands', async () => {
    const { host } = await render({
      brands: { ...marked, refusalPhrase: 'Doar mărci germane' },
    });

    expect(lines(host)).toEqual([
      'Lucrează pe: BMW, Dacia',
      'Nu primește: Doar mărci germane',
    ]);
  });
});

describe('the mechanics and the service area on the preview', () => {
  const mechanics = [{ name: 'Mihai Dumitru', speciality: 'Electrică auto' }];

  it('shows each mechanic with initials and the invitation note while the switch is on', async () => {
    const { host, set } = await render({
      mechanics: { mechanics, onProfile: true },
    });

    const rows = [...host.querySelectorAll('.mechanic')];
    expect(rows).toHaveLength(1);
    const avatar = rows[0]?.querySelector('.avatar');
    expect(text(avatar)).toBe('MD');
    expect(avatar?.getAttribute('aria-hidden')).toBe('true');
    expect(text(rows[0])).toContain('Mihai Dumitru');
    expect(text(rows[0])).toContain('apare după ce acceptă invitația');

    await set({ mechanics: { mechanics, onProfile: false } });
    expect(host.querySelectorAll('.mechanic')).toHaveLength(0);
  });

  it('shows the service area of a mobile mechanic, and no location line for a fixed garage', async () => {
    const { host, set } = await render({ details: { businessKind: 'mobile' } });
    expect(text(host.querySelector('.mobile'))).toBe(
      'Mobil · 20 km în jurul sediului',
    );

    await set({ details: { businessKind: 'company' } });
    expect(host.querySelector('.mobile')).toBeNull();
  });
});

describe('what the preview never shows', () => {
  const PHONE = '+40712345678';
  const SEAT = 'Strada Secretă 7, Cluj';
  const SPECIALITY = 'Specialitate ascunsă';

  it.each([
    [{ businessKind: 'mobile', name: 'Mecanic', phone: PHONE }],
    [{ businessKind: 'company', name: SEAT, phone: PHONE }],
    [{ phone: PHONE }],
  ] as const)(
    'keeps the phone, the seat address and the speciality off the card for %j',
    async (details) => {
      const { host } = await render({
        details: { ...details, knownFor: SEAT },
        mechanics: {
          mechanics: [{ name: 'Ana Pop', speciality: SPECIALITY }],
          onProfile: true,
        },
      });

      const shown = host.textContent ?? '';
      expect(shown).not.toContain(PHONE);
      expect(shown).not.toContain('0712345678');
      expect(shown).not.toContain(SPECIALITY);
      if (!('name' in details) || details.name !== SEAT)
        expect(shown).not.toContain(SEAT);
    },
  );
});

describe('the preview panel on a phone', () => {
  it('starts collapsed behind a "Previzualizare" button that names what it controls', async () => {
    const { host } = await render();

    const button = toggle(host);
    expect(button?.tagName).toBe('BUTTON');
    expect(button?.type).toBe('button');
    expect(text(button)).toBe('Previzualizare');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    const body = host.querySelector(
      `#${button?.getAttribute('aria-controls')}`,
    );
    expect(body).not.toBeNull();
    expect(body?.classList.contains('open')).toBe(false);
    expect(text(body)).toContain('Cum îl vor vedea șoferii');
  });

  it('opens and closes on the button, saying so', async () => {
    const { fixture, host } = await render();
    const button = toggle(host) as HTMLButtonElement;
    const body = () =>
      host.querySelector(`#${button.getAttribute('aria-controls')}`);

    button.click();
    await settle(fixture);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(body()?.classList.contains('open')).toBe(true);

    button.click();
    await settle(fixture);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(body()?.classList.contains('open')).toBe(false);
  });

  it('gives each preview its own panel id', async () => {
    const { host } = await render();
    const other = TestBed.createComponent(GaragePreview);
    other.componentRef.setInput('brands', { brands: [] });
    other.componentRef.setInput('details', {});
    other.componentRef.setInput('mechanics', {});
    other.componentRef.setInput('order', []);
    await settle(other);

    expect(toggle(host)?.getAttribute('aria-controls')).not.toBe(
      toggle(other.nativeElement)?.getAttribute('aria-controls'),
    );
  });
});
