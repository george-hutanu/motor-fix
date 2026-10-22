import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { LiveMessage } from '@motor-fix/contracts';
import {
  AdminService,
  type CopyVoiceDto,
  type CopyVoicesDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Subject } from 'rxjs';

import { CopyVoices } from './copy-voices';
import { Live } from '../live';

type State = { enabled: boolean; pinned: boolean };

const ON: State = { enabled: true, pinned: false };
const OFF: State = { enabled: false, pinned: false };
const PINNED: State = { enabled: true, pinned: true };

// The quote requests and listings started of each voice, 0 when not given.
type Counts = Partial<Record<number, [number, number]>>;

const voices = (
  states: Partial<Record<number, State>> = {},
  counts: Counts = {},
): CopyVoicesDto => ({
  voices: [1, 2, 3, 4, 5].map(
    (voice): CopyVoiceDto => ({
      ...(states[voice] ?? ON),
      listings: counts[voice]?.[1] ?? 0,
      requests: counts[voice]?.[0] ?? 0,
      updatedAt: null,
      voice,
    }),
  ),
});

const NAMES = [
  '1 · La obiect',
  '2 · Ca de la un prieten',
  '3 · Tehnic',
  '4 · Cu zâmbet',
  '5 · Fără surprize',
];

let list: jest.Mock;
let change: jest.Mock;
let events: Subject<LiveMessage>;
let resync: Subject<void>;

async function render(
  answer: CopyVoicesDto | Promise<never> = voices(),
  language: 'ro' | 'en' = 'ro',
) {
  list = jest.fn(() =>
    answer instanceof Promise ? answer : Promise.resolve(answer),
  );
  change = jest.fn(() => new Promise(() => undefined));
  events = new Subject();
  resync = new Subject();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AdminService,
        useValue: {
          copyVoicesControllerChange: change,
          copyVoicesControllerList: list,
        },
      },
      { provide: Live, useValue: { events, resync } },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('admin');
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(CopyVoices);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
  };
  await settle();
  return { element, fixture, settle };
}

const rows = (element: HTMLElement) => [...element.querySelectorAll('li')];
const row = (element: HTMLElement, voice: number) => rows(element)[voice - 1];
const text = (node: Element) =>
  (node.textContent ?? '').replace(/\s+/g, ' ').trim();
const toggle = (element: HTMLElement, voice: number) =>
  row(element, voice).querySelector<HTMLButtonElement>(
    'button[role="switch"]',
  ) as HTMLButtonElement;
const pin = (element: HTMLElement, voice: number) =>
  row(element, voice).querySelector<HTMLButtonElement>(
    'button[data-pin]',
  ) as HTMLButtonElement;
const alert = (element: HTMLElement) =>
  element.querySelector('[role="alert"]')?.textContent?.trim();
const refusal = (status: number, code?: string) =>
  new HttpErrorResponse({ error: code ? { code } : null, status });
const changed = (id: string): LiveMessage =>
  ({
    at: '2026-10-22T10:00:00.000Z',
    id,
    kind: 'platform_rule.changed',
  }) as LiveMessage;

afterEach(() => jest.useRealTimers());

// @traces 010-FR-012
describe('the copy voices section', () => {
  it('shows the heading and one row per voice: name, example headline with BMW, a switch and the pin', async () => {
    const { element } = await render();

    expect(element.querySelector('h2')?.textContent?.trim()).toBe(
      'Voci de text',
    );
    expect(rows(element)).toHaveLength(5);
    NAMES.forEach((name, i) => {
      expect(text(rows(element)[i])).toContain(name);
      expect(toggle(element, i + 1).getAttribute('aria-label')).toBe(name);
      expect(toggle(element, i + 1).getAttribute('aria-checked')).toBe('true');
      expect(text(pin(element, i + 1))).toBe('Fixează pentru toți');
    });
    expect(text(row(element, 1))).toContain('Cine se pricepe la BMW?');
    expect(text(row(element, 5))).toContain(
      'Știi cât costă înainte să lași cheile.',
    );
  });

  it('fills every placeholder of the example headline, voice 3 included', async () => {
    const { element } = await render();

    for (const li of rows(element)) expect(text(li)).not.toMatch(/[{}]/);
    expect(text(row(element, 3))).toContain('BMW.');
  });

  it('keeps the switch and the pin together on one line after the name', async () => {
    const { element } = await render();

    rows(element).forEach((li, i) => {
      const controls = li.querySelector('.controls');
      expect(controls).not.toBeNull();
      expect(controls?.contains(toggle(element, i + 1))).toBe(true);
      expect(controls?.contains(pin(element, i + 1))).toBe(true);
      expect(li.querySelector('.name')?.nextElementSibling).toBe(controls);
    });
  });

  it('reads in English', async () => {
    const { element } = await render(voices({ 2: PINNED }), 'en');

    expect(element.querySelector('h2')?.textContent?.trim()).toBe(
      'Copy voices',
    );
    expect(text(row(element, 1))).toContain('1 · Straight to the point');
    expect(text(row(element, 1))).toContain('Who’s tuned for your BMW?');
    expect(text(row(element, 1))).toContain('paused while voice 2 is pinned');
    expect(text(pin(element, 2))).toBe('Remove pin');
    expect(text(pin(element, 3))).toBe('Pin for everyone');
  });

  it('shows placeholders and no control while the voices load', async () => {
    const { element } = await render(new Promise<never>(() => undefined));

    expect(element.querySelector('h2')?.textContent?.trim()).toBe(
      'Voci de text',
    );
    expect(element.querySelectorAll('.skeleton')).toHaveLength(5);
    expect(element.querySelectorAll('button[role="switch"]')).toHaveLength(0);
  });

  it('offers to try again when the voices cannot be read', async () => {
    const { element, settle } = await render(Promise.reject(new Error('down')));

    expect(alert(element)).toBe('Nu am putut încărca vocile');
    list.mockResolvedValueOnce(voices());
    [...element.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Reîncearcă')
      ?.click();
    await settle();

    expect(rows(element)).toHaveLength(5);
    expect(alert(element)).toBeUndefined();
  });
});

// @traces 010-FR-014
describe('saving a voice', () => {
  it('moves the switch at once and sends the state the screen showed', async () => {
    const { element, settle } = await render();

    toggle(element, 3).click();
    await settle();

    expect(change).toHaveBeenCalledWith({
      body: { ...OFF, seen: ON },
      voice: '3',
    });
    expect(toggle(element, 3).getAttribute('aria-checked')).toBe('false');
    expect(toggle(element, 3).disabled).toBe(true);
  });

  it('keeps the answer the server gave', async () => {
    const { element, settle } = await render();
    change.mockResolvedValueOnce(voices({ 3: OFF }));

    toggle(element, 3).click();
    await settle();

    expect(toggle(element, 3).getAttribute('aria-checked')).toBe('false');
    expect(toggle(element, 3).disabled).toBe(false);
    expect(alert(element)).toBeUndefined();
  });

  it('puts the last voice back on and says one stays on', async () => {
    const { element, settle } = await render(
      voices({ 1: OFF, 2: OFF, 3: OFF, 4: OFF }),
    );
    change.mockRejectedValueOnce(refusal(422, 'last_voice'));

    toggle(element, 5).click();
    await settle();

    expect(toggle(element, 5).getAttribute('aria-checked')).toBe('true');
    expect(alert(element)).toBe('Cel puțin o voce rămâne activă');
  });

  it('reads the voices again on a stale change and says so', async () => {
    const { element, settle } = await render();
    change.mockRejectedValueOnce(refusal(409, 'stale_value'));
    list.mockResolvedValueOnce(voices({ 3: OFF }));

    toggle(element, 3).click();
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
    expect(toggle(element, 3).getAttribute('aria-checked')).toBe('false');
    expect(alert(element)).toBe(
      'Vocea s‑a schimbat între timp. Am citit‑o din nou.',
    );
  });

  it.each([refusal(500), refusal(422, 'voice_pinned'), new Error('offline')])(
    'puts the row back and shows the generic error on %p',
    async (failure) => {
      const { element, settle } = await render();
      change.mockRejectedValueOnce(failure);

      toggle(element, 2).click();
      await settle();

      expect(toggle(element, 2).getAttribute('aria-checked')).toBe('true');
      expect(alert(element)).toBe('Nu am putut salva. Încearcă din nou.');
    },
  );

  it('clears the error on the next save', async () => {
    const { element, settle } = await render();
    change.mockRejectedValueOnce(refusal(500));
    toggle(element, 2).click();
    await settle();

    toggle(element, 4).click();
    await settle();

    expect(alert(element)).toBeUndefined();
  });
});

// @traces 010-FR-013
describe('pinning a voice', () => {
  it('pins at once, moving the pin off any other voice', async () => {
    const { element, settle } = await render(voices({ 2: PINNED }));

    pin(element, 5).click();
    await settle();

    expect(change).toHaveBeenCalledWith({
      body: { ...PINNED, seen: ON },
      voice: '5',
    });
    expect(text(pin(element, 5))).toBe('Scoate fixarea');
    expect(text(pin(element, 2))).toBe('Fixează pentru toți');
    expect(text(row(element, 2))).toContain('în pauză cât e fixată vocea 5');
  });

  it('marks the other rows paused, the pinned switch locked', async () => {
    const { element } = await render(voices({ 2: OFF, 4: PINNED }));

    expect(toggle(element, 4).disabled).toBe(true);
    expect(text(row(element, 4))).toContain('Scoate fixarea ca să o oprești');
    expect(
      element.querySelector(
        `#${toggle(element, 4).getAttribute('aria-describedby')}`,
      )?.textContent,
    ).toContain('Scoate fixarea ca să o oprești');
    expect(text(row(element, 4))).not.toContain('în pauză');
    for (const voice of [1, 2, 3, 5]) {
      expect(text(row(element, voice))).toContain(
        'în pauză cât e fixată vocea 4',
      );
      expect(toggle(element, voice).disabled).toBe(false);
    }
  });

  it('cannot pin a voice that is off', async () => {
    const { element } = await render(voices({ 3: OFF }));

    expect(pin(element, 3).disabled).toBe(true);
    expect(pin(element, 2).disabled).toBe(false);
  });

  it('removes the pin', async () => {
    const { element, settle } = await render(voices({ 4: PINNED }));

    pin(element, 4).click();
    await settle();

    expect(change).toHaveBeenCalledWith({
      body: { ...ON, seen: PINNED },
      voice: '4',
    });
    expect(text(element)).not.toContain('în pauză');
    expect(toggle(element, 4).disabled).toBe(true);
  });

  it('puts the pin back where it was on a refusal', async () => {
    const { element, settle } = await render(voices({ 2: PINNED }));
    change.mockRejectedValueOnce(refusal(422, 'voice_off'));

    pin(element, 5).click();
    await settle();

    expect(text(pin(element, 2))).toBe('Scoate fixarea');
    expect(text(pin(element, 5))).toBe('Fixează pentru toți');
    expect(alert(element)).toBe('Nu am putut salva. Încearcă din nou.');
  });
});

// @traces 010-FR-015
describe('a change made elsewhere', () => {
  it('reads the voices again on a copy voices change, once for a burst', async () => {
    jest.useFakeTimers();
    const { settle } = await render();
    list.mockResolvedValue(voices({ 1: OFF }));

    events.next(changed('copy_voices'));
    events.next(changed('copy_voices'));
    jest.advanceTimersByTime(300);
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
  });

  it('ignores a change of another rule', async () => {
    jest.useFakeTimers();
    const { settle } = await render();

    events.next(changed('maintenance_mode'));
    jest.advanceTimersByTime(300);
    await settle();

    expect(list).toHaveBeenCalledTimes(1);
  });

  it('reads the voices again when the stream opens again', async () => {
    const { settle } = await render();

    resync.next();
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
  });
});

// @traces 009-FR-009
describe('what each voice brought in', () => {
  const COUNTS: Counts = { 1: [12, 3], 2: [1, 20], 4: [12345, 1] };
  // The lines of a row's name column: the name, the example, the counts.
  const lines = (element: HTMLElement, voice: number) =>
    [...(row(element, voice).querySelector('.name')?.children ?? [])].map(text);

  it('shows the counts under the example line, in Romanian plurals', async () => {
    const { element } = await render(voices({}, COUNTS));

    expect(lines(element, 1).slice(1, 3)).toEqual([
      'Cine se pricepe la BMW?',
      '12 cereri de ofertă · 3 înscrieri începute',
    ]);
    expect(lines(element, 2)[2]).toBe(
      '1 cerere de ofertă · 20 de înscrieri începute',
    );
    expect(lines(element, 3)[2]).toBe(
      '0 cereri de ofertă · 0 înscrieri începute',
    );
    expect(lines(element, 4)[2]).toBe(
      '12.345 de cereri de ofertă · 1 înscriere începută',
    );
  });

  it('shows the counts in English', async () => {
    const { element } = await render(voices({}, COUNTS), 'en');

    expect(lines(element, 1).slice(1, 3)).toEqual([
      'Who’s tuned for your BMW?',
      '12 quote requests · 3 listings started',
    ]);
    expect(lines(element, 2)[2]).toBe('1 quote request · 20 listings started');
    expect(lines(element, 3)[2]).toBe('0 quote requests · 0 listings started');
    expect(lines(element, 4)[2]).toBe(
      '12,345 quote requests · 1 listing started',
    );
  });

  it('names the 30 days once, in the section’s hint', async () => {
    const ro = await render(voices({}, COUNTS));
    expect(text(ro.element.querySelector('p.hint') as Element)).toBe(
      'Ce variante de text văd vizitatorii pe prima pagină · totaluri în ultimele 30 de zile',
    );
    expect(text(ro.element).split('30 de zile')).toHaveLength(2);
    TestBed.resetTestingModule();

    const en = await render(voices({}, COUNTS), 'en');
    expect(text(en.element.querySelector('p.hint') as Element)).toBe(
      'Which copy visitors see on the home page · totals in the last 30 days',
    );
  });
});
