import { DOCUMENT } from '@angular/common';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationStart, provideRouter, Router } from '@angular/router';
import { I18n } from '@motor-fix/i18n';

import {
  injectOverlayTask,
  type OverlayOptions,
  type OverlayResult,
  Overlays,
} from './index';

type Done = 'saved';

@Component({
  template: `
    <label for="name">Nume</label>
    <input id="name" />
    <button id="done" type="button" (click)="task.close('saved')">Gata</button>
    <button id="clean" type="button" (click)="task.markUnchanged()">Salvat</button>
    <button id="again" type="button" (click)="openAgain()">Încă una</button>
    <p id="data">{{ task.data?.greeting }}</p>
  `,
})
class FormTask {
  readonly task = injectOverlayTask<{ greeting: string } | undefined, Done>();
  private readonly overlays = inject(Overlays);
  inner?: Promise<OverlayResult<Done>>;

  openAgain() {
    this.inner = this.overlays.open<Done>(FormTask, {
      shape: 'dialog',
      title: 'shell.brand',
    });
  }
}

@Component({ template: `<p id="read">Doar de citit</p>` })
class ReadTask {}

@Component({
  template: `
    <div style="height: 4000px"></div>
    <button id="opener" type="button" (click)="open()">Deschide</button>
  `,
})
class Host {
  private readonly overlays = inject(Overlays);
  options: OverlayOptions<unknown> = { shape: 'dialog', title: 'shell.brand' };
  task: Parameters<Overlays['open']>[0] = FormTask;
  result?: Promise<OverlayResult<Done>>;

  open() {
    this.result = this.overlays.open<Done, unknown>(this.task, this.options);
  }
}

let computer = true;

beforeEach(() => {
  computer = true;
  globalThis.matchMedia = (query: string) =>
    ({
      addEventListener() {},
      addListener() {},
      matches: computer && query.includes('min-width: 768px'),
      media: query,
      removeEventListener() {},
      removeListener() {},
    }) as unknown as MediaQueryList;
});

afterEach(() => {
  document.querySelector('.cdk-overlay-container')?.remove();
});

async function settle() {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function render(setup: (host: Host) => void = () => {}): Promise<Host> {
  const fixture = TestBed.createComponent(Host);
  setup(fixture.componentInstance);
  fixture.detectChanges();
  return fixture.componentInstance;
}

async function openTask(setup?: (host: Host) => void) {
  const host = await render(setup);
  const opener = document.querySelector<HTMLButtonElement>('#opener');
  opener?.focus();
  opener?.click();
  await settle();
  return { host, opener };
}

const dialogs = () => [
  ...document.querySelectorAll<HTMLElement>(
    '.cdk-overlay-pane [role="dialog"]',
  ),
];
const top = () => dialogs().at(-1) as HTMLElement;
const panel = () => top().querySelector<HTMLElement>('mf-overlay-panel');
const closeButton = () =>
  top().querySelector<HTMLButtonElement>('button.mf-overlay-close');
const body = () => top().querySelector<HTMLElement>('.mf-overlay-body');
const question = () => top().querySelector<HTMLElement>('[role="alertdialog"]');
const text = (key: string) => TestBed.inject(I18n).t(key);
const marker = () =>
  (history.state as { mfOverlay?: number } | null)?.mfOverlay;

async function back() {
  history.back();
  await settle();
}

function pressEscape() {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
  );
}

function clickOutside() {
  const backdrops = document.querySelectorAll<HTMLElement>(
    '.cdk-overlay-backdrop',
  );
  backdrops[backdrops.length - 1]?.click();
}

function type(value: string) {
  const input = top().querySelector<HTMLInputElement>('#name');
  if (!input) throw new Error('no field');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('Overlays: open and close', () => {
  it('opens a task on top as a modal dialog named by its title', async () => {
    await openTask();

    const dialog = top();
    expect(dialogs()).toHaveLength(1);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(
      dialog.getAttribute('aria-labelledby') ?? '',
    );
    expect(title?.textContent?.trim()).toBe(text('shell.brand'));
    expect(title?.tagName).toBe('H2');
    expect(dialog.querySelector('#name')).not.toBeNull();
  });

  it('names its close button Închide / Close', async () => {
    await openTask();

    expect(closeButton()?.getAttribute('aria-label')).toBe(
      text('shell.overlay.close'),
    );
    expect(text('shell.overlay.close')).toBe('Închide');
  });

  it.each([
    ['the X', () => closeButton()?.click()],
    ['Escape', pressEscape],
    ['a click outside', clickOutside],
  ])('closes with %s and hands the opener "cancelled"', async (_, close) => {
    const { host } = await openTask();

    close();
    await settle();

    expect(dialogs()).toHaveLength(0);
    await expect(host.result).resolves.toBe('cancelled');
  });

  it('hands the opener the result the task closes with', async () => {
    const { host } = await openTask();

    top().querySelector<HTMLButtonElement>('#done')?.click();
    await settle();

    expect(dialogs()).toHaveLength(0);
    await expect(host.result).resolves.toBe('saved');
  });

  it('passes the opener’s data to the task', async () => {
    await openTask((host) => {
      host.options = {
        data: { greeting: 'Bună' },
        shape: 'dialog',
        title: 'shell.brand',
      };
    });

    expect(top().querySelector('#data')?.textContent).toBe('Bună');
  });

  it.each([
    ['the X', () => closeButton()?.click()],
    ['Escape', pressEscape],
    ['a click outside', clickOutside],
    [
      'its own result',
      () => top().querySelector<HTMLButtonElement>('#done')?.click(),
    ],
  ])(
    'keeps the address and leaves no entry behind when closed with %s',
    async (_, close) => {
      history.pushState({ page: 'earlier' }, '');
      history.pushState({ page: 'here' }, '');
      const href = location.href;
      await openTask();
      expect(marker()).toEqual(expect.any(Number));

      close();
      await settle();

      expect(dialogs()).toHaveLength(0);
      expect(location.href).toBe(href);
      expect(history.state).toEqual({ page: 'here' });
      await back();
      expect(history.state).toEqual({ page: 'earlier' });
    },
  );

  it('leaves no entry behind when two stacked tasks close by the X', async () => {
    history.pushState({ page: 'earlier' }, '');
    history.pushState({ page: 'here' }, '');
    await openTask();
    top().querySelector<HTMLButtonElement>('#again')?.click();
    await settle();
    expect(marker()).toEqual(expect.any(Number));

    closeButton()?.click();
    await settle();
    closeButton()?.click();
    await settle();

    expect(dialogs()).toHaveLength(0);
    expect(history.state).toEqual({ page: 'here' });
    await back();
    expect(history.state).toEqual({ page: 'earlier' });
  });

  it('hands the opener its result only once the browser has stepped back', async () => {
    const { host } = await openTask();
    const seen: string[] = [];
    const stepped = () => seen.push('step back');
    window.addEventListener('popstate', stepped);
    void host.result?.then((result) => seen.push(result));

    top().querySelector<HTMLButtonElement>('#done')?.click();
    await settle();
    window.removeEventListener('popstate', stepped);

    expect(seen).toEqual(['step back', 'saved']);
  });

  it('moves no history when it closes after the page moved on', async () => {
    const { host } = await openTask();
    history.pushState({ page: 'elsewhere' }, '');
    const stepped = jest.fn();
    window.addEventListener('popstate', stepped);

    closeButton()?.click();
    await settle();
    window.removeEventListener('popstate', stepped);

    expect(dialogs()).toHaveLength(0);
    await expect(host.result).resolves.toBe('cancelled');
    expect(history.state).toEqual({ page: 'elsewhere' });
    expect(stepped).not.toHaveBeenCalled();
  });
});

describe('Overlays: the browser’s Back button', () => {
  it('adds one entry at the same address, marked as the task’s own, on open', async () => {
    history.pushState({ page: 'here' }, '');
    const href = location.href;
    const length = history.length;

    await openTask();

    expect(location.href).toBe(href);
    expect(history.length).toBe(length + 1);
    expect(history.state).toEqual({
      mfOverlay: expect.any(Number),
      page: 'here',
    });
  });

  it('closes only the top task on each Back, hands "cancelled" and keeps the page', async () => {
    history.pushState({ page: 'here' }, '');
    const href = location.href;
    const { host, opener } = await openTask();
    const again = top().querySelector<HTMLButtonElement>('#again');
    again?.focus();
    again?.click();
    await settle();

    await back();
    expect(dialogs()).toHaveLength(1);
    expect(document.activeElement).toBe(again);
    expect(location.href).toBe(href);

    await back();
    expect(dialogs()).toHaveLength(0);
    await expect(host.result).resolves.toBe('cancelled');
    expect(document.activeElement).toBe(opener);
    expect(history.state).toEqual({ page: 'here' });
  });

  it('reopens nothing on Forward after a Back, and moves nothing in answer', async () => {
    await openTask();
    await back();
    expect(dialogs()).toHaveLength(0);

    history.forward();
    await settle();

    expect(dialogs()).toHaveLength(0);
    expect(marker()).toEqual(expect.any(Number));
  });

  it('keeps the router still on the open, on Back and on a close', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const router = TestBed.inject(Router);
    router.initialNavigation();
    await settle();
    const starts: string[] = [];
    const watching = router.events.subscribe(
      (event) => event instanceof NavigationStart && starts.push(event.url),
    );

    await openTask();
    await back();
    expect(dialogs()).toHaveLength(0);
    const opener = document.querySelector<HTMLButtonElement>('#opener');
    opener?.click();
    await settle();
    closeButton()?.click();
    await settle();
    watching.unsubscribe();

    expect(dialogs()).toHaveLength(0);
    expect(starts).toEqual([]);
  });

  it('adds no entry and closes at once where there is no window', async () => {
    const page = new Proxy(document, {
      get(target, key) {
        if (key === 'defaultView') return null;
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: page }],
    });
    history.pushState({ page: 'here' }, '');
    const length = history.length;
    const { host } = await openTask();
    expect(dialogs()).toHaveLength(1);
    expect(history.length).toBe(length);

    closeButton()?.click();
    await settle();

    expect(dialogs()).toHaveLength(0);
    await expect(host.result).resolves.toBe('cancelled');
    expect(history.state).toEqual({ page: 'here' });
  });
});

describe('Overlays: focus', () => {
  it('on a computer puts the focus on the first field, not on the X', async () => {
    await openTask();

    expect(document.activeElement?.id).toBe('name');
  });

  it('on a phone puts the focus on the dialog itself, so no keyboard opens', async () => {
    computer = false;
    await openTask();

    expect(document.activeElement).toBe(top());
  });

  it('with no field puts the focus on the dialog', async () => {
    await openTask((host) => {
      host.task = ReadTask;
    });

    expect(document.activeElement).toBe(top());
  });

  it('keeps the focus inside with a focus trap, and returns it to the opener on close', async () => {
    const { opener } = await openTask();

    expect(
      top().parentElement?.querySelectorAll('.cdk-focus-trap-anchor').length,
    ).toBeGreaterThanOrEqual(2);

    pressEscape();
    await settle();

    expect(document.activeElement).toBe(opener);
  });
});

describe('Overlays: the page behind', () => {
  it('dims the page with the theme mask and blocks its scrolling until the task closes', async () => {
    // jsdom lays nothing out; the page is taller than the window here.
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 4000,
    });
    await openTask();

    const backdrop = document.querySelector('.cdk-overlay-backdrop');
    expect(backdrop?.classList).toContain('spartan-dialog-overlay');
    expect(document.documentElement.classList).toContain(
      'cdk-global-scrollblock',
    );

    pressEscape();
    await settle();

    expect(document.documentElement.classList).not.toContain(
      'cdk-global-scrollblock',
    );
  });
});

describe('Overlays: shapes', () => {
  it('opens a dialog on the kit’s centred dialog surface', async () => {
    await openTask();

    expect(panel()?.classList).toContain('spartan-dialog-content');
    expect(panel()?.classList).toContain('mf-overlay-dialog');
    expect(panel()?.classList).not.toContain('spartan-sheet-content');
  });

  it.each([
    ['drawer', 'mf-overlay-drawer'],
    ['drawer-wide', 'mf-overlay-drawer-wide'],
  ] as const)(
    'opens a %s on the right-hand sheet surface',
    async (shape, cls) => {
      await openTask((host) => {
        host.options = { shape, title: 'shell.brand' };
      });

      expect(panel()?.classList).toContain('spartan-sheet-content');
      expect(panel()?.classList).toContain(cls);
      expect(panel()?.getAttribute('data-side')).toBe('right');
    },
  );

  it('scrolls the body, not the header with the X', async () => {
    await openTask();

    expect(body()?.contains(top().querySelector('#name'))).toBe(true);
    expect(body()?.contains(closeButton())).toBe(false);
  });
});

describe('Overlays: the discard question', () => {
  it.each([
    ['the X', () => closeButton()?.click()],
    ['Escape', pressEscape],
    ['a click outside', clickOutside],
  ])('asks before %s closes a changed task', async (_, close) => {
    await openTask();
    type('Ion');

    close();
    await settle();

    expect(dialogs()).toHaveLength(1);
    expect(question()?.textContent).toContain(
      text('shell.overlay.discard.question'),
    );
    expect(body()?.hidden).toBe(true);
    const buttons = [...(question()?.querySelectorAll('button') ?? [])].map(
      (b) => b.textContent?.trim(),
    );
    expect(buttons).toEqual(
      expect.arrayContaining([
        text('shell.overlay.discard.discard'),
        text('shell.overlay.discard.keep'),
      ]),
    );
  });

  const button = (key: string) =>
    [...(question()?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent?.trim() === text(key),
    );

  it('keeps editing with the text kept, by the button or by Escape', async () => {
    await openTask();
    type('Ion');
    pressEscape();
    await settle();

    button('shell.overlay.discard.keep')?.click();
    await settle();
    expect(question()).toBeNull();
    expect(body()?.hidden).toBe(false);
    expect(top().querySelector<HTMLInputElement>('#name')?.value).toBe('Ion');

    pressEscape();
    await settle();
    pressEscape();
    await settle();
    expect(question()).toBeNull();
    expect(dialogs()).toHaveLength(1);
  });

  it('discards: closes the task and hands the opener "cancelled"', async () => {
    const { host } = await openTask();
    type('Ion');
    closeButton()?.click();
    await settle();

    button('shell.overlay.discard.discard')?.click();
    await settle();

    expect(dialogs()).toHaveLength(0);
    await expect(host.result).resolves.toBe('cancelled');
  });

  it('ignores a click outside while it asks', async () => {
    await openTask();
    type('Ion');
    pressEscape();
    await settle();

    clickOutside();
    await settle();

    expect(question()).not.toBeNull();
  });

  it('does not ask when nothing changed, after markUnchanged, when switched off, or on a result', async () => {
    const cases: Array<(host: Host) => Promise<void>> = [
      async () => {},
      async () => {
        type('Ion');
        top().querySelector<HTMLButtonElement>('#clean')?.click();
      },
    ];
    for (const prepare of cases) {
      const { host } = await openTask();
      await prepare(host);
      pressEscape();
      await settle();
      expect(dialogs()).toHaveLength(0);
      await expect(host.result).resolves.toBe('cancelled');
    }

    const off = await openTask((host) => {
      host.options = {
        confirmDiscard: false,
        shape: 'dialog',
        title: 'shell.brand',
      };
    });
    type('Ion');
    pressEscape();
    await settle();
    expect(dialogs()).toHaveLength(0);
    await expect(off.host.result).resolves.toBe('cancelled');

    const done = await openTask();
    type('Ion');
    top().querySelector<HTMLButtonElement>('#done')?.click();
    await settle();
    expect(dialogs()).toHaveLength(0);
    await expect(done.host.result).resolves.toBe('saved');
  });
});

describe('Overlays: stacked tasks', () => {
  it('opens a task from a task on top; Escape and outside close only the top one', async () => {
    await openTask();
    const again = top().querySelector<HTMLButtonElement>('#again');
    again?.focus();
    again?.click();
    await settle();
    expect(dialogs()).toHaveLength(2);

    pressEscape();
    await settle();
    expect(dialogs()).toHaveLength(1);
    expect(document.activeElement).toBe(again);

    again?.click();
    await settle();
    clickOutside();
    await settle();
    expect(dialogs()).toHaveLength(1);
  });
});

describe('Overlays: a task still loading', () => {
  it('shows the title, the X and a busy skeleton at once, then the task', async () => {
    let arrive: (task: typeof FormTask) => void = () => {};
    const loading = new Promise<typeof FormTask>((resolve) => {
      arrive = resolve;
    });
    await openTask((host) => {
      host.task = () => loading;
    });

    expect(closeButton()).not.toBeNull();
    expect(body()?.getAttribute('aria-busy')).toBe('true');
    expect(body()?.querySelector('.mf-overlay-skeleton')).not.toBeNull();
    expect(top().querySelector('#name')).toBeNull();

    arrive(FormTask);
    await settle();

    expect(body()?.getAttribute('aria-busy')).toBeNull();
    expect(body()?.querySelector('.mf-overlay-skeleton')).toBeNull();
    expect(document.activeElement?.id).toBe('name');
  });
});
