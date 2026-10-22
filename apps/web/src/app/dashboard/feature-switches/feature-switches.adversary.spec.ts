import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { MeDto } from '@motor-fix/data-access';
import { Overlays } from '@motor-fix/overlays';

import { FeatureSwitches } from './feature-switches';
import { Session } from '../session';

const GARAGE = 'a3b5c7d9-0000-4000-8000-000000000001';
const TEAM = 'Echipă și mecanici';
const LIFT = 'Program pe elevatoare';
const SAVE_FAILED = 'Nu am putut salva. Încearcă din nou.';

const me = (features: unknown) =>
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

let open: jest.Mock;
let http: HttpTestingController;
let current: ReturnType<typeof signal<MeDto | null>>;

async function render(features: unknown, confirm: unknown = true) {
  open = jest.fn(async () => confirm);
  current = signal<MeDto | null>(me(features));
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: Session, useValue: { current, reload: jest.fn() } },
      { provide: Overlays, useValue: { open } },
    ],
  });
  http = TestBed.inject(HttpTestingController);
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
  return { element, settle };
}

const switches = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLButtonElement>('button[role="switch"]'),
];
const named = (element: HTMLElement, name: string) =>
  switches(element).find(
    (c) => c.getAttribute('aria-label') === name,
  ) as HTMLButtonElement;
const states = (element: HTMLElement) =>
  switches(element).map((c) => c.getAttribute('aria-checked'));
const puts = () => http.match((req) => req.method === 'PUT');

afterEach(() => {
  http.match(() => true);
});

// @traces 398-FR-002
describe('FeatureSwitches with unusual account data', () => {
  it('shows five switches on when the garage entry has no features at all', async () => {
    const { element } = await render(undefined);

    expect(states(element)).toEqual(['true', 'true', 'true', 'true', 'true']);
  });

  it('shows five switches on when features is null', async () => {
    const { element } = await render(null);

    expect(states(element)).toEqual(['true', 'true', 'true', 'true', 'true']);
  });

  it('ignores a key that is not one of the five', async () => {
    const { element } = await render({ unknown_key: false, whatsapp: false });

    expect(switches(element)).toHaveLength(5);
    expect(states(element)).toEqual(['true', 'true', 'true', 'true', 'false']);
  });

  it('follows the session when another tab changes a switch', async () => {
    const { element, settle } = await render({});

    current.set(me({ team_mechanics: false }));
    await settle();

    expect(states(element)).toEqual(['false', 'true', 'true', 'true', 'true']);
  });
});

// @traces 398-FR-010 398-FR-011
describe('FeatureSwitches under repeated and odd input', () => {
  it('sends one write for two taps on a switch while it is saving', async () => {
    const { element, settle } = await render({ lift_schedule: false });

    named(element, LIFT).click();
    await settle();
    named(element, LIFT).click();
    await settle();

    expect(puts()).toHaveLength(1);
  });

  it('asks once for two quick taps on a switch being turned off', async () => {
    const { element, settle } = await render({});

    named(element, LIFT).click();
    await settle();
    named(element, LIFT).click();
    await settle();

    expect(open).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['false', false],
    ['null', null],
    ['an Escape dismissal', 'dismissed'],
  ])('saves nothing when the confirmation answers %s', async (_n, answer) => {
    const { element, settle } = await render({}, answer);

    named(element, LIFT).click();
    await settle();

    expect(puts()).toHaveLength(0);
    expect(states(element)).toEqual(['true', 'true', 'true', 'true', 'true']);
  });

  it('keeps the switch where it was when a 200 answer carries no features', async () => {
    const { element, settle } = await render({ lift_schedule: false });

    named(element, LIFT).click();
    await settle();
    http
      .expectOne((r) => r.method === 'PUT')
      .flush({}, { status: 200, statusText: 'OK' });
    await settle();

    expect(named(element, LIFT).disabled).toBe(false);
    expect(['true', 'false']).toContain(
      named(element, LIFT).getAttribute('aria-checked'),
    );
  });

  it('saves nothing when the confirmation closes with no answer', async () => {
    const { element, settle } = await render({});
    open.mockResolvedValue(undefined);

    named(element, LIFT).click();
    await settle();

    expect(puts()).toHaveLength(0);
    expect(states(element)).toEqual(['true', 'true', 'true', 'true', 'true']);
  });

  it('shows the generic failure for a 403, a 404 and a 401', async () => {
    for (const status of [401, 403, 404]) {
      TestBed.resetTestingModule();
      const { element, settle } = await render({ lift_schedule: false });
      named(element, LIFT).click();
      await settle();
      http
        .expectOne((r) => r.method === 'PUT')
        .flush({ code: 'x' }, { status, statusText: 'No' });
      await settle();

      expect(named(element, LIFT).getAttribute('aria-checked')).toBe('false');
      expect(
        named(element, LIFT).closest('li')?.querySelector('[role="alert"]')
          ?.textContent,
      ).toContain(SAVE_FAILED);
    }
  });

  it('saves two different rows at the same time without mixing them up', async () => {
    const { element, settle } = await render({
      lift_schedule: false,
      team_mechanics: false,
    });

    named(element, LIFT).click();
    named(element, TEAM).click();
    await settle();
    const [first, second] = puts();
    expect(first?.request.url).toContain('/features/lift_schedule');
    expect(second?.request.url).toContain('/features/team_mechanics');
    first?.flush(
      { features: { lift_schedule: true, team_mechanics: false } },
      { status: 200, statusText: 'OK' },
    );
    second?.flush(
      { features: { lift_schedule: true, team_mechanics: true } },
      { status: 200, statusText: 'OK' },
    );
    await settle();

    expect(named(element, LIFT).getAttribute('aria-checked')).toBe('true');
    expect(named(element, TEAM).getAttribute('aria-checked')).toBe('true');
  });

  it('clears the failure message of a row once that row saves', async () => {
    const { element, settle } = await render({ lift_schedule: false });
    named(element, LIFT).click();
    await settle();
    http
      .expectOne((r) => r.method === 'PUT')
      .flush({}, { status: 500, statusText: 'Err' });
    await settle();

    named(element, LIFT).click();
    await settle();
    expect(
      named(element, LIFT).closest('li')?.querySelector('[role="alert"]')
        ?.textContent ?? '',
    ).not.toContain(SAVE_FAILED);
  });
});
