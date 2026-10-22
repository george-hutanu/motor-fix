import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FEATURE_KEYS } from '@motor-fix/contracts';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { FeatureOffConfirm } from './feature-off-confirm';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const LINES = {
  en: {
    day_sheets:
      'The day sheet and its send disappear; the team gets no more day sheets.',
    lift_schedule:
      'Lifts disappear from the bookings, the menu and the day sheets.',
    live_media: 'The “Photo, video, live” buttons disappear from the jobs.',
    team_mechanics:
      'The mechanics, the invitations and the choice of mechanic disappear from the menu and the bookings.',
    whatsapp:
      'WhatsApp messages to your team stop. Customers are not affected.',
  },
  ro: {
    day_sheets:
      'Fișa zilei și trimiterea ei dispar; echipa nu mai primește foi de lucru.',
    lift_schedule:
      'Elevatoarele dispar din programări, din meniu și din fișele de lucru.',
    live_media: 'Butoanele „Foto, video, live” dispar din lucrări.',
    team_mechanics:
      'Mecanicii, invitațiile și alegerea mecanicului dispar din meniu și din programări.',
    whatsapp:
      'Mesajele WhatsApp către echipa ta se opresc. Clienții nu sunt afectați.',
  },
};

const NAMES_RO = {
  day_sheets: 'Foi de lucru',
  lift_schedule: 'Program pe elevatoare',
  live_media: 'Poze și video live',
  team_mechanics: 'Echipă și mecanici',
  whatsapp: 'WhatsApp',
};

let result: Promise<OverlayResult<true>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  key: (typeof FEATURE_KEYS)[number] = 'team_mechanics',
  language: 'ro' | 'en' = 'ro',
) {
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<true, { key: string }>(
    FeatureOffConfirm,
    {
      data: { key },
      shape: 'dialog',
      title: 'garage.features.confirm.title',
      titleParams: { name: NAMES_RO[key] },
    },
  );
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const body = () =>
  panel().querySelector('mf-feature-off-confirm') as HTMLElement;
const button = (name: string) =>
  [...body().querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  ) as HTMLButtonElement;

afterEach(() => {
  document.body.innerHTML = '';
});

// @traces 398-FR-010 398-FR-012
describe('the switch-off confirmation', () => {
  it('titles the dialog with the feature name and offers the two buttons', async () => {
    await open('team_mechanics');

    expect(panel().textContent).toContain('Oprești „Echipă și mecanici”?');
    expect(
      [...body().querySelectorAll('button')].map((b) => b.textContent?.trim()),
    ).toEqual(['Renunță', 'Oprește']);
  });

  it.each(FEATURE_KEYS)(
    'says what disappears for %s in Romanian',
    async (key) => {
      await open(key);

      expect(body().textContent).toContain(LINES.ro[key]);
    },
  );

  it.each(FEATURE_KEYS)(
    'says what disappears for %s in English',
    async (key) => {
      await open(key, 'en');

      expect(body().textContent).toContain(LINES.en[key]);
    },
  );

  it('offers Cancel and Switch off in English', async () => {
    await open('whatsapp', 'en');

    expect(
      [...body().querySelectorAll('button')].map((b) => b.textContent?.trim()),
    ).toEqual(['Cancel', 'Switch off']);
  });

  it('closes with true on "Oprește"', async () => {
    await open('live_media');

    button('Oprește').click();

    expect(await result).toBe(true);
  });

  it('closes with cancelled on "Renunță"', async () => {
    await open('live_media');

    button('Renunță').click();

    expect(await result).toBe('cancelled');
  });
});
