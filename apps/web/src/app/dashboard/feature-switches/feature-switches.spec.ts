import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FEATURE_KEYS } from '@motor-fix/contracts';
import type { MeDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { FeatureSwitches } from './feature-switches';
import { Session } from '../session';

const GARAGE = 'a3b5c7d9-0000-4000-8000-000000000001';

const NAMES = {
  en: [
    'Team and mechanics',
    'Schedule by lift',
    'Live photos and video',
    'Day sheets',
    'WhatsApp',
  ],
  ro: [
    'Echipă și mecanici',
    'Program pe elevatoare',
    'Poze și video live',
    'Foi de lucru',
    'WhatsApp',
  ],
};

const DESCRIPTIONS_RO = [
  'Mecanicii tăi, invitațiile și alegerea mecanicului la programare.',
  'Programările pe elevatoare și alegerea elevatorului.',
  'Poze, video și transmisiuni live din atelier pentru client.',
  'Fișa zilei pentru fiecare mecanic, de tipărit sau de trimis.',
  'Mesajele WhatsApp către echipa ta: foi de lucru și alerte.',
];

const SAVE_FAILED = 'Nu am putut salva. Încearcă din nou.';
const MECHANICS_ON_TEAM = 'Scoate mai întâi mecanicii din echipă.';

const me = (features: Record<string, boolean>) =>
  ({
    capabilities: ['garage.feature_switches'],
    garageAccess: [
      {
        features,
        garageId: GARAGE,
        name: 'Atelier Test',
        role: 'owner',
        status: 'approved',
      },
    ],
    garageId: GARAGE,
    id: 'account-1',
    role: 'garage',
  }) as unknown as MeDto;

const allOn = () =>
  Object.fromEntries(FEATURE_KEYS.map((key) => [key, true])) as Record<
    string,
    boolean
  >;

let open: jest.Mock;
let http: HttpTestingController;

async function render(
  features: Record<string, boolean> = {},
  language: 'ro' | 'en' = 'ro',
) {
  open = jest.fn(async () => true);
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: Session,
        useValue: { current: signal(me(features)), reload: jest.fn() },
      },
      { provide: Overlays, useValue: { open } },
    ],
  });
  http = TestBed.inject(HttpTestingController);
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(FeatureSwitches);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
    }
  };
  await settle();
  return { element, fixture, settle };
}

const switches = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLButtonElement>('button[role="switch"]'),
];
const named = (element: HTMLElement, name: string) =>
  switches(element).find(
    (control) => control.getAttribute('aria-label') === name,
  ) as HTMLButtonElement;
const states = (element: HTMLElement) =>
  switches(element).map((control) => control.getAttribute('aria-checked'));
const alertOf = (element: HTMLElement, name: string) =>
  named(element, name)
    .closest('li')
    ?.querySelector('p[role="alert"]')
    ?.textContent?.trim();
const put = (key: string) =>
  http.expectOne(
    (req) =>
      req.method === 'PUT' &&
      req.url.endsWith(`/api/v1/garages/${GARAGE}/features/${key}`),
  );
const noPut = () =>
  expect(http.match((req) => req.method === 'PUT')).toHaveLength(0);

const TEAM = NAMES.ro[0] as string;
const LIFT = NAMES.ro[1] as string;

afterEach(() => http.verify());

// @traces 398-FR-001 398-FR-002 398-FR-005 398-FR-010 398-FR-011 398-FR-012

describe('FeatureSwitches', () => {
  it('shows the five features in order with their names and descriptions', async () => {
    const { element } = await render();

    expect(
      switches(element).map((control) => control.getAttribute('aria-label')),
    ).toEqual(NAMES.ro);
    expect(
      switches(element).map((control) =>
        (control.getAttribute('aria-describedby') ?? '')
          .split(' ')
          .filter(Boolean)
          .map((id) =>
            element.querySelector(`[id="${id}"]`)?.textContent?.trim(),
          )
          .join(' '),
      ),
    ).toEqual(DESCRIPTIONS_RO);
  });

  it('shows the panel title and its intro in Romanian', async () => {
    const { element } = await render();

    expect(element.textContent).toContain('Funcții');
    expect(element.textContent).toContain(
      'Oprește ce nu folosește service‑ul tău. Ce oprești dispare din meniu și din ecrane pentru toată echipa.',
    );
  });

  it('shows the names in English', async () => {
    const { element } = await render({}, 'en');

    expect(
      switches(element).map((control) => control.getAttribute('aria-label')),
    ).toEqual(NAMES.en);
  });

  it('shows a key with no stored row as on and a stored false as off', async () => {
    const { element } = await render({ lift_schedule: false, whatsapp: false });

    expect(states(element)).toEqual(['true', 'false', 'true', 'true', 'false']);
  });

  it('describes each switch by a distinct element of its own row', async () => {
    const { element } = await render();

    const ids = switches(element).map((control) =>
      control.getAttribute('aria-describedby'),
    );
    expect(new Set(ids).size).toBe(5);
    for (const control of switches(element)) {
      const id = control.getAttribute('aria-describedby') as string;
      expect(
        control.closest('li')?.querySelector(`[id="${id}"]`),
      ).not.toBeNull();
    }
  });

  it('saves a switch turned on at once, with no confirmation', async () => {
    const { element, settle } = await render({ lift_schedule: false });

    named(element, LIFT).click();
    await settle();

    expect(open).not.toHaveBeenCalled();
    const req = put('lift_schedule');
    expect(req.request.body).toEqual({ enabled: true });
    req.flush({ features: { ...allOn() } });
    await settle();
    expect(states(element)).toEqual(['true', 'true', 'true', 'true', 'true']);
  });

  it('shows the states of the answer after a save and clears the message', async () => {
    const { element, settle } = await render({ lift_schedule: false });
    named(element, LIFT).click();
    await settle();
    put('lift_schedule').flush({}, { status: 500, statusText: 'Error' });
    await settle();
    expect(alertOf(element, LIFT)).toBe(SAVE_FAILED);

    named(element, LIFT).click();
    await settle();
    put('lift_schedule').flush({
      features: { ...allOn(), team_mechanics: false },
    });
    await settle();

    expect(states(element)).toEqual(['false', 'true', 'true', 'true', 'true']);
    expect(alertOf(element, LIFT)).toBeUndefined();
  });

  it('asks before switching off and saves only once the answer is true', async () => {
    const { element, settle } = await render();

    named(element, LIFT).click();
    await settle();

    expect(open).toHaveBeenCalledTimes(1);
    const options = open.mock.calls[0]?.[1];
    expect(options.data).toEqual({ key: 'lift_schedule' });
    expect(options.shape).toBe('dialog');
    const req = put('lift_schedule');
    expect(req.request.body).toEqual({ enabled: false });
    req.flush({ features: { ...allOn(), lift_schedule: false } });
    await settle();
    expect(states(element)).toEqual(['true', 'false', 'true', 'true', 'true']);
  });

  it('keeps the switch on and saves nothing when the confirmation is cancelled', async () => {
    const { element, settle } = await render();
    open.mockResolvedValue('cancelled');

    named(element, LIFT).click();
    await settle();

    expect(open).toHaveBeenCalledTimes(1);
    noPut();
    expect(states(element)).toEqual(['true', 'true', 'true', 'true', 'true']);
  });

  it('disables only the row that is saving while its save is pending', async () => {
    const { element, settle } = await render({ lift_schedule: false });

    named(element, LIFT).click();
    await settle();

    expect(named(element, LIFT).disabled).toBe(true);
    expect(named(element, TEAM).disabled).toBe(false);
    put('lift_schedule').flush({ features: allOn() });
    await settle();
    expect(named(element, LIFT).disabled).toBe(false);
  });

  it('flips the switch back and says so in an alert when the save fails', async () => {
    const { element, settle } = await render({ lift_schedule: false });

    named(element, LIFT).click();
    await settle();
    put('lift_schedule').flush(
      { code: 'internal_error' },
      { status: 500, statusText: 'Error' },
    );
    await settle();

    expect(named(element, LIFT).getAttribute('aria-checked')).toBe('false');
    expect(named(element, LIFT).disabled).toBe(false);
    expect(alertOf(element, LIFT)).toBe(SAVE_FAILED);
  });

  it('flips the switch back when the network fails', async () => {
    const { element, settle } = await render();

    named(element, LIFT).click();
    await settle();
    put('lift_schedule').error(new ProgressEvent('error'));
    await settle();

    expect(named(element, LIFT).getAttribute('aria-checked')).toBe('true');
    expect(alertOf(element, LIFT)).toBe(SAVE_FAILED);
  });

  it('shows its own text for mechanics on the team, never the server message', async () => {
    const { element, settle } = await render();

    named(element, TEAM).click();
    await settle();
    put('team_mechanics').flush(
      {
        code: 'mechanics_on_team',
        message: 'Remove the mechanics from the team first.',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await settle();

    expect(named(element, TEAM).getAttribute('aria-checked')).toBe('true');
    expect(alertOf(element, TEAM)).toBe(MECHANICS_ON_TEAM);
  });

  it('shows the text for mechanics on the team in English', async () => {
    const { element, settle } = await render({}, 'en');

    named(element, NAMES.en[0] as string).click();
    await settle();
    put('team_mechanics').flush(
      { code: 'mechanics_on_team', message: 'Scoate' },
      { status: 409, statusText: 'Conflict' },
    );
    await settle();

    expect(alertOf(element, NAMES.en[0] as string)).toBe(
      'Remove the mechanics from the team first.',
    );
  });

  it('shows the save failure text for a 409 with another code', async () => {
    const { element, settle } = await render();

    named(element, TEAM).click();
    await settle();
    put('team_mechanics').flush(
      { code: 'something_else', message: 'Server words' },
      { status: 409, statusText: 'Conflict' },
    );
    await settle();

    expect(alertOf(element, TEAM)).toBe(SAVE_FAILED);
  });
});
