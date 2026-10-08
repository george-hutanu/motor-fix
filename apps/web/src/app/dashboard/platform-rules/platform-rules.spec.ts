import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { LiveMessage } from '@motor-fix/contracts';
import {
  AdminService,
  type PlatformRuleChangeDto,
  type PlatformRuleChangesDto,
  type PlatformRuleDto,
  type PlatformRulesDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { Subject } from 'rxjs';

import { PlatformRules } from './platform-rules';
import { RuleOffRequest } from './rule-off-request/rule-off-request';
import { Live } from '../live';

const rule = (
  key: string,
  value: boolean,
  twoAdmins = false,
): PlatformRuleDto => ({
  defaultValue: value,
  key,
  requiresTwoAdmins: twoAdmins,
  updatedAt: null,
  updatedBy: null,
  value,
});

const testing = (
  overrides: Partial<Record<string, boolean>> = {},
): PlatformRulesDto => ({
  production: false,
  rules: [
    rule('maintenance_mode', overrides['maintenance_mode'] ?? false),
    rule(
      'reviews_only_after_confirmed_job',
      overrides['reviews_only_after_confirmed_job'] ?? true,
      true,
    ),
    rule('skip_manual_approval', overrides['skip_manual_approval'] ?? false),
    rule('skip_rar_check', overrides['skip_rar_check'] ?? false),
    rule('perf_slow_answer_ms', true),
  ],
});

const production = (): PlatformRulesDto => ({
  production: true,
  rules: [
    rule('maintenance_mode', false),
    rule('reviews_only_after_confirmed_job', true, true),
  ],
});

const NAMES = [
  'Autorizație RAR obligatorie',
  'Recenzii doar după o lucrare confirmată',
  'Aprobare manuală pentru service‑uri noi',
  'Mod mentenanță',
];

const REVIEWS = 'Recenzii doar după o lucrare confirmată';

const request = (
  overrides: Partial<PlatformRuleChangeDto> = {},
): PlatformRuleChangeDto => ({
  decidedAt: null,
  decidedByName: null,
  id: 'change-1',
  key: 'reviews_only_after_confirmed_job',
  mine: false,
  reason: 'Testăm recenziile din profil.',
  requestedAt: '2026-10-08T09:00:00.000Z',
  requestedByName: 'Ioana',
  status: 'requested',
  ...overrides,
});

const NO_REQUESTS: PlatformRuleChangesDto = { decided: [], waiting: null };

let list: jest.Mock;
let change: jest.Mock;
let requests: jest.Mock;
let approve: jest.Mock;
let refuse: jest.Mock;
let cancel: jest.Mock;
let open: jest.Mock;
let events: Subject<LiveMessage>;
let resync: Subject<void>;

async function render(
  answer: PlatformRulesDto | Promise<never> = testing(),
  language: 'ro' | 'en' = 'ro',
) {
  list = jest.fn(() =>
    answer instanceof Promise ? answer : Promise.resolve(answer),
  );
  change = jest.fn(() => new Promise(() => undefined));
  requests = jest.fn(async () => NO_REQUESTS);
  approve = jest.fn(async () => request({ status: 'approved' }));
  refuse = jest.fn(async () => request({ status: 'refused' }));
  cancel = jest.fn(async () => request({ status: 'cancelled' }));
  open = jest.fn(async () => 'cancelled');
  events = new Subject();
  resync = new Subject();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AdminService,
        useValue: {
          platformRuleChangesControllerApprove: approve,
          platformRuleChangesControllerCancel: cancel,
          platformRuleChangesControllerList: requests,
          platformRuleChangesControllerRefuse: refuse,
          platformRulesControllerChange: change,
          platformRulesControllerList: list,
        },
      },
      { provide: Live, useValue: { events, resync } },
      {
        provide: Overlays,
        useValue: { open: (...a: unknown[]) => open(...a) },
      },
    ],
  });
  // The area's texts load apart; the loading state is read before any await.
  await TestBed.inject(I18n).enter('admin');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(PlatformRules);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
  };
  return { element, fixture, settle };
}

const switches = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLButtonElement>('button[role="switch"]'),
];
const named = (element: HTMLElement, name: string) =>
  switches(element).find((s) => s.getAttribute('aria-label') === name);
const checked = (element: HTMLElement, name: string) =>
  named(element, name)?.getAttribute('aria-checked');
const text = (element: HTMLElement) =>
  (element.textContent ?? '').replace(/\s+/g, ' ').trim();
const lines = (element: HTMLElement) =>
  [...element.querySelectorAll('li')].map((li) =>
    (li.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );

const live = (kind: string): LiveMessage =>
  ({ at: '2026-10-08T09:00:00.000Z', id: 'change-1', kind }) as LiveMessage;
const button = (element: HTMLElement, name: string) =>
  [...element.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  ) as HTMLButtonElement | undefined;
const card = (element: HTMLElement) =>
  element.querySelector<HTMLElement>('[data-waiting]');

const changed = (key: string): LiveMessage =>
  ({
    at: '2026-10-07T12:00:00.000Z',
    id: key,
    kind: 'platform_rule.changed',
  }) as LiveMessage;

afterEach(() => jest.useRealTimers());

describe('PlatformRules', () => {
  it('opens with the heading and the line, then the four rules in order', async () => {
    const { element, settle } = await render();
    await settle();

    expect(element.querySelector('h2')?.textContent?.trim()).toBe(
      'Setări platformă',
    );
    expect(text(element)).toContain(
      'Regulile care se aplică tuturor service‑urilor',
    );
    const shown = lines(element);
    expect(shown).toHaveLength(4);
    NAMES.forEach((name, i) => {
      expect(shown[i]).toContain(name);
    });
  });

  it('shows every rule as a switch named by its rule outside production, the test-only ones marked', async () => {
    const { element, settle } = await render();
    await settle();

    expect(switches(element).map((s) => s.getAttribute('aria-label'))).toEqual(
      NAMES,
    );
    const shown = lines(element);
    expect(shown[0]).toContain('Doar în testare');
    expect(shown[2]).toContain('Doar în testare');
    expect(shown[1]).not.toContain('Doar în testare');
    expect(shown[3]).not.toContain('Doar în testare');
  });

  it('shows a test-only rule on while its check is required', async () => {
    const { element, settle } = await render(
      testing({ skip_manual_approval: true }),
    );
    await settle();

    expect(checked(element, 'Autorizație RAR obligatorie')).toBe('true');
    expect(checked(element, 'Aprobare manuală pentru service‑uri noi')).toBe(
      'false',
    );
    expect(checked(element, 'Recenzii doar după o lucrare confirmată')).toBe(
      'true',
    );
    expect(checked(element, 'Mod mentenanță')).toBe('false');
  });

  it('locks the RAR and manual approval lines in production, marked always on', async () => {
    const { element, settle } = await render(production());
    await settle();

    expect(switches(element).map((s) => s.getAttribute('aria-label'))).toEqual([
      'Recenzii doar după o lucrare confirmată',
      'Mod mentenanță',
    ]);
    const shown = lines(element);
    expect(shown).toHaveLength(4);
    expect(shown[0]).toContain('Mereu active în producție');
    expect(shown[2]).toContain('Mereu active în producție');
    expect(text(element)).not.toContain('Doar în testare');
  });

  it('shows the heading and four placeholders, and no control, while the rules load', async () => {
    const { element, fixture, settle } = await render();
    let resolve: (value: PlatformRulesDto) => void = () => undefined;
    list.mockReturnValueOnce(
      new Promise<PlatformRulesDto>((r) => {
        resolve = r;
      }),
    );
    fixture.detectChanges();

    expect(element.querySelector('h2')?.textContent?.trim()).toBe(
      'Setări platformă',
    );
    expect(
      element.querySelectorAll('[aria-hidden="true"].skeleton'),
    ).toHaveLength(4);
    expect(switches(element)).toHaveLength(0);

    resolve(testing());
    await settle();
    expect(element.querySelectorAll('.skeleton')).toHaveLength(0);
    expect(switches(element)).toHaveLength(4);
  });

  it('offers to try again when the rules cannot be read, and reads again', async () => {
    const { element, settle } = await render(Promise.reject(new Error('down')));
    await settle();

    expect(text(element)).toContain('Nu am putut încărca regulile');
    const retry = [...element.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Reîncearcă',
    );
    expect(retry).toBeDefined();
    list.mockResolvedValueOnce(testing());
    retry?.click();
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
    expect(switches(element)).toHaveLength(4);
    expect(text(element)).not.toContain('Nu am putut încărca regulile');
  });

  it('moves a switch at once and sends the value seen', async () => {
    const { element, settle } = await render();
    await settle();

    named(element, 'Mod mentenanță')?.click();
    await settle();

    expect(change).toHaveBeenCalledWith({
      body: { seen: false, value: true },
      key: 'maintenance_mode',
    });
    expect(checked(element, 'Mod mentenanță')).toBe('true');
  });

  it('sends a skip value when a test-only switch is turned off', async () => {
    const { element, settle } = await render();
    await settle();

    named(element, 'Autorizație RAR obligatorie')?.click();
    await settle();

    expect(change).toHaveBeenCalledWith({
      body: { seen: false, value: true },
      key: 'skip_rar_check',
    });
    expect(checked(element, 'Autorizație RAR obligatorie')).toBe('false');
  });

  it('keeps the switch where it went when the change is saved', async () => {
    const { element, settle } = await render();
    await settle();
    change.mockResolvedValueOnce(rule('maintenance_mode', true));

    named(element, 'Mod mentenanță')?.click();
    await settle();

    expect(checked(element, 'Mod mentenanță')).toBe('true');
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  it('puts the switch back and shows an error line when the change fails', async () => {
    const { element, settle } = await render();
    await settle();
    change.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));

    named(element, 'Mod mentenanță')?.click();
    await settle();

    expect(checked(element, 'Mod mentenanță')).toBe('false');
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'Regula nu a putut fi salvată',
    );
  });

  it('says a second admin is needed when the server refuses a change the screen thought was free', async () => {
    // A screen read before the rule needed two admins sends the change.
    const stale = testing();
    stale.rules[1] = rule('reviews_only_after_confirmed_job', true);
    const { element, settle } = await render(stale);
    await settle();
    change.mockRejectedValueOnce(
      new HttpErrorResponse({
        error: { code: 'two_admins_required' },
        status: 409,
      }),
    );

    named(element, 'Recenzii doar după o lucrare confirmată')?.click();
    await settle();

    expect(open).not.toHaveBeenCalled();
    expect(checked(element, 'Recenzii doar după o lucrare confirmată')).toBe(
      'true',
    );
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'Este nevoie de un al doilea administrator',
    );
  });

  it('reads the rules again and shows the saved state when the value seen was stale', async () => {
    const { element, settle } = await render();
    await settle();
    change.mockRejectedValueOnce(
      new HttpErrorResponse({ error: { code: 'stale_value' }, status: 409 }),
    );
    list.mockResolvedValueOnce(testing({ maintenance_mode: true }));

    named(element, 'Mod mentenanță')?.click();
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
    expect(checked(element, 'Mod mentenanță')).toBe('true');
  });

  it('puts the switch back and shows an error line when the value seen was stale and the rules cannot be read again', async () => {
    const { element, settle } = await render();
    await settle();
    change.mockRejectedValueOnce(
      new HttpErrorResponse({ error: { code: 'stale_value' }, status: 409 }),
    );
    list.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));

    named(element, 'Mod mentenanță')?.click();
    await settle();
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
    expect(checked(element, 'Mod mentenanță')).toBe('false');
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'Regula nu a putut fi salvată',
    );
  });

  it('ignores a second change of a rule while its first is on its way', async () => {
    const { element, settle } = await render();
    await settle();

    named(element, 'Mod mentenanță')?.click();
    await settle();
    named(element, 'Mod mentenanță')?.click();
    await settle();

    expect(change).toHaveBeenCalledTimes(1);
    expect(checked(element, 'Mod mentenanță')).toBe('true');
  });

  it('reads the rules again once per burst of changes from the live connection', async () => {
    const { element, settle } = await render();
    await settle();
    jest.useFakeTimers();
    list.mockResolvedValue(testing({ maintenance_mode: true }));

    events.next(changed('maintenance_mode'));
    events.next(changed('skip_rar_check'));
    jest.advanceTimersByTime(300);
    jest.useRealTimers();
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
    expect(checked(element, 'Mod mentenanță')).toBe('true');
  });

  it('keeps the switch still when its own saved change comes back live', async () => {
    const { element, settle } = await render();
    await settle();
    change.mockResolvedValueOnce(rule('maintenance_mode', true));
    named(element, 'Mod mentenanță')?.click();
    await settle();
    let reread: (value: PlatformRulesDto) => void = () => undefined;
    list.mockReturnValueOnce(
      new Promise<PlatformRulesDto>((r) => {
        reread = r;
      }),
    );
    jest.useFakeTimers();

    events.next(changed('maintenance_mode'));
    jest.advanceTimersByTime(300);
    jest.useRealTimers();
    await settle();
    expect(checked(element, 'Mod mentenanță')).toBe('true');
    expect(switches(element)).toHaveLength(4);

    reread(testing({ maintenance_mode: true }));
    await settle();
    expect(checked(element, 'Mod mentenanță')).toBe('true');
  });

  it('speaks English', async () => {
    const { element, settle } = await render(production(), 'en');
    await settle();

    expect(element.querySelector('h2')?.textContent?.trim()).toBe(
      'Platform settings',
    );
    expect(text(element)).toContain('The rules that apply to every garage');
    expect(switches(element).map((s) => s.getAttribute('aria-label'))).toEqual([
      'Reviews only after a confirmed job',
      'Maintenance mode',
    ]);
    expect(lines(element)[0]).toContain('RAR licence required');
    expect(lines(element)[0]).toContain('Always on in production');
  });
});

describe('PlatformRules, switching the reviews rule off', () => {
  it('opens the request dialog instead of sending the change, and keeps the switch on', async () => {
    const { element, settle } = await render();
    await settle();

    named(element, REVIEWS)?.click();
    await settle();

    expect(change).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(RuleOffRequest, {
      data: { key: 'reviews_only_after_confirmed_job' },
      shape: 'dialog',
      title: 'admin.platformRules.request.title',
    });
    expect(checked(element, REVIEWS)).toBe('true');
  });

  it('shows the waiting card once the request is sent', async () => {
    const { element, settle } = await render();
    await settle();
    open.mockResolvedValueOnce(request({ mine: true }));
    requests.mockResolvedValue({
      decided: [],
      waiting: request({ mine: true }),
    });

    named(element, REVIEWS)?.click();
    await settle();
    await settle();

    expect(card(element)?.textContent).toContain('Retrage cererea');
  });

  it('reads the requests of the reviews rule only', async () => {
    const { settle } = await render();
    await settle();

    expect(requests).toHaveBeenCalledWith({
      key: 'reviews_only_after_confirmed_job',
    });
    expect(requests).toHaveBeenCalledTimes(1);
  });
});

describe('PlatformRules, a request waiting', () => {
  const waiting = async (mine = false, language: 'ro' | 'en' = 'ro') => {
    const rendered = await render(testing(), language);
    requests.mockResolvedValue({ decided: [], waiting: request({ mine }) });
    await rendered.settle();
    return rendered;
  };

  it('shows the switch on and locked, the mark, and who asked, when and why', async () => {
    const { element } = await waiting();

    expect(checked(element, REVIEWS)).toBe('true');
    expect(named(element, REVIEWS)?.disabled).toBe(true);
    const shown = card(element)?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(shown).toContain('Așteaptă aprobarea altui admin');
    expect(shown).toContain('Ioana');
    expect(shown).toContain('12:00');
    expect(shown).toContain('Testăm recenziile din profil.');
  });

  it('offers another admin Approve and Refuse, and no withdrawal', async () => {
    const { element } = await waiting();

    expect(button(element, 'Aprobă')).toBeDefined();
    expect(button(element, 'Refuză')).toBeDefined();
    expect(button(element, 'Retrage cererea')).toBeUndefined();
  });

  it('offers the asker only the withdrawal', async () => {
    const { element } = await waiting(true);

    expect(button(element, 'Retrage cererea')).toBeDefined();
    expect(button(element, 'Aprobă')).toBeUndefined();
    expect(button(element, 'Refuză')).toBeUndefined();
  });

  it('approves by the request id and reads the rules and the requests again', async () => {
    const { element, settle } = await waiting();
    list.mockClear();
    requests.mockClear();

    button(element, 'Aprobă')?.click();
    await settle();

    expect(approve).toHaveBeenCalledWith({ id: 'change-1' });
    expect(list).toHaveBeenCalled();
    expect(requests).toHaveBeenCalled();
  });

  it('refuses and withdraws by the request id', async () => {
    const other = await waiting();
    button(other.element, 'Refuză')?.click();
    await other.settle();
    expect(refuse).toHaveBeenCalledWith({ id: 'change-1' });

    TestBed.resetTestingModule();
    const asker = await waiting(true);
    button(asker.element, 'Retrage cererea')?.click();
    await asker.settle();
    expect(cancel).toHaveBeenCalledWith({ id: 'change-1' });
  });

  it('ignores a second press while the decision is on its way', async () => {
    const { element, settle } = await waiting();
    approve.mockReturnValue(new Promise(() => undefined));

    button(element, 'Aprobă')?.click();
    await settle();
    button(element, 'Aprobă')?.click();
    button(element, 'Refuză')?.click();
    await settle();

    expect(approve).toHaveBeenCalledTimes(1);
    expect(refuse).not.toHaveBeenCalled();
  });

  it('re-reads without an error line when another admin decided first', async () => {
    const { element, settle } = await waiting();
    approve.mockRejectedValueOnce(
      new HttpErrorResponse({
        error: { code: 'already_decided' },
        status: 409,
      }),
    );
    requests.mockClear();

    button(element, 'Aprobă')?.click();
    await settle();

    expect(requests).toHaveBeenCalled();
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  it('re-reads and shows an error line when the decision fails', async () => {
    const { element, settle } = await waiting();
    approve.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    requests.mockClear();

    button(element, 'Aprobă')?.click();
    await settle();

    expect(requests).toHaveBeenCalled();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'Regula nu a putut fi salvată',
    );
  });

  it('shows no card when the requests cannot be read', async () => {
    const rendered = await render();
    requests.mockRejectedValue(new HttpErrorResponse({ status: 500 }));
    await rendered.settle();

    expect(card(rendered.element)).toBeNull();
    expect(text(rendered.element)).toContain('Nu am putut încărca regulile');
  });

  it('speaks English', async () => {
    const { element } = await waiting(false, 'en');

    const shown = card(element)?.textContent ?? '';
    expect(shown).toContain("Waiting for another admin's approval");
    expect(button(element, 'Approve')).toBeDefined();
    expect(button(element, 'Refuse')).toBeDefined();
  });
});

describe('PlatformRules, decided requests', () => {
  it('lists each decision with who, when and why, newest first', async () => {
    const rendered = await render();
    requests.mockResolvedValue({
      decided: [
        request({
          decidedAt: '2026-10-08T10:00:00.000Z',
          decidedByName: 'Mihai',
          id: 'a',
          reason: 'Motivul aprobat.',
          status: 'approved',
        }),
        request({
          decidedAt: '2026-10-07T10:00:00.000Z',
          decidedByName: 'Elena',
          id: 'b',
          reason: 'Motivul refuzat.',
          status: 'refused',
        }),
        request({
          decidedAt: '2026-10-06T10:00:00.000Z',
          decidedByName: 'Ioana',
          id: 'c',
          reason: 'Motivul retras.',
          status: 'cancelled',
        }),
      ],
      waiting: null,
    });
    await rendered.settle();

    const history = [
      ...rendered.element.querySelectorAll('[data-decided] > *'),
    ].map((n) => (n.textContent ?? '').replace(/\s+/g, ' ').trim());
    expect(history).toHaveLength(3);
    expect(history[0]).toContain('Aprobată de Mihai · ');
    expect(history[0]).toContain('13:00');
    expect(history[0]).toContain('Motivul aprobat.');
    expect(history[1]).toContain('Refuzată de Elena · ');
    expect(history[2]).toContain('Retrasă de Ioana · ');
    expect(history[2]).toContain('Motivul retras.');
  });

  it('shows no history when nothing was decided', async () => {
    const { element, settle } = await render();
    await settle();

    expect(element.querySelector('[data-decided]')).toBeNull();
  });
});

describe('PlatformRules, live requests', () => {
  it.each(['platform_rule.change_requested', 'platform_rule.change_decided'])(
    'reads the rules and the requests again on %s',
    async (kind) => {
      const { element, settle } = await render();
      await settle();
      list.mockClear();
      requests.mockClear();
      requests.mockResolvedValue({ decided: [], waiting: request() });
      jest.useFakeTimers();

      events.next(live(kind));
      jest.advanceTimersByTime(300);
      jest.useRealTimers();
      await settle();

      expect(list).toHaveBeenCalledTimes(1);
      expect(requests).toHaveBeenCalledTimes(1);
      expect(card(element)).not.toBeNull();
    },
  );

  it('announces the waiting state through a live region', async () => {
    const rendered = await render();
    requests.mockResolvedValue({ decided: [], waiting: request() });
    await rendered.settle();

    const region = rendered.element.querySelector('[aria-live="polite"]');
    expect(region?.textContent).toContain('Așteaptă aprobarea altui admin');
  });
});
