import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import {
  injectOverlayTask,
  type OverlayOptions,
  type OverlayResult,
  Overlays,
} from './index';

type Done = 'saved' | 'other';

@Component({
  template: `
    <input id="name" />
    <button id="saved" type="button" (click)="task.close('saved')">a</button>
    <button id="other" type="button" (click)="task.close('other')">b</button>
    <button id="twice" type="button" (click)="closeTwice()">c</button>
    <button id="again" type="button" (click)="openAgain()">d</button>
    <p id="data">{{ task.data?.greeting }}</p>
  `,
})
class FormTask {
  readonly task = injectOverlayTask<{ greeting: string } | undefined, Done>();
  private readonly overlays = inject(Overlays);
  static inners: Array<Promise<OverlayResult<Done>>> = [];

  closeTwice() {
    this.task.close('saved');
    this.task.close('other');
  }

  openAgain() {
    FormTask.inners.push(
      this.overlays.open<Done>(FormTask, {
        shape: 'dialog',
        title: 'shell.brand',
      }),
    );
  }
}

@Component({
  template: `
    <button id="opener" type="button" (click)="open()">Deschide</button>
  `,
})
class Host {
  private readonly overlays = inject(Overlays);
  options: OverlayOptions<unknown> = { shape: 'dialog', title: 'shell.brand' };
  task: Parameters<Overlays['open']>[0] = FormTask;
  results: Array<Promise<OverlayResult<Done>>> = [];

  open() {
    this.results.push(
      this.overlays.open<Done, unknown>(this.task, this.options),
    );
  }
}

beforeEach(() => {
  FormTask.inners = [];
  globalThis.matchMedia = (query: string) =>
    ({
      addEventListener() {},
      addListener() {},
      matches: query.includes('min-width: 768px'),
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

async function openTask(setup: (host: Host) => void = () => {}) {
  const fixture = TestBed.createComponent(Host);
  setup(fixture.componentInstance);
  fixture.detectChanges();
  const opener = document.querySelector<HTMLButtonElement>('#opener');
  opener?.focus();
  opener?.click();
  await settle();
  return { fixture, host: fixture.componentInstance, opener };
}

const dialogs = () => [
  ...document.querySelectorAll<HTMLElement>(
    '.cdk-overlay-pane [role="dialog"]',
  ),
];
const top = () => dialogs().at(-1) as HTMLElement;
const closeButton = () =>
  top().querySelector<HTMLButtonElement>('button.mf-overlay-close');
const question = () => top().querySelector<HTMLElement>('[role="alertdialog"]');
const text = (key: string) => TestBed.inject(I18n).t(key);
const click = (selector: string) =>
  top().querySelector<HTMLButtonElement>(selector)?.click();

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

describe('Overlays adversary: closing twice', () => {
  it('keeps the first result when a task closes itself twice with different results', async () => {
    const { host } = await openTask();

    click('#twice');
    await settle();

    expect(dialogs()).toHaveLength(0);
    await expect(host.results[0]).resolves.toBe('saved');
  });

  it('keeps the result when the X is pressed after the task closed itself', async () => {
    const { host } = await openTask();
    const x = closeButton();

    click('#other');
    x?.click();
    await settle();

    expect(dialogs()).toHaveLength(0);
    await expect(host.results[0]).resolves.toBe('other');
  });

  it('keeps cancelled when Escape is pressed twice in a row', async () => {
    const { host } = await openTask();

    pressEscape();
    pressEscape();
    await settle();

    expect(dialogs()).toHaveLength(0);
    await expect(host.results[0]).resolves.toBe('cancelled');
  });

  it('closes a task whose X is pressed twice with no settling in between', async () => {
    const { host } = await openTask();
    const x = closeButton();

    x?.click();
    x?.click();
    await settle();

    expect(dialogs()).toHaveLength(0);
    await expect(host.results[0]).resolves.toBe('cancelled');
  });
});

describe('Overlays adversary: stacked tasks and the discard question', () => {
  it('Escape on the discard question of the top task keeps both tasks open', async () => {
    await openTask();
    click('#again');
    await settle();
    expect(dialogs()).toHaveLength(2);
    type('Ion');

    pressEscape();
    await settle();
    expect(question()).not.toBeNull();

    pressEscape();
    await settle();

    expect(dialogs()).toHaveLength(2);
    expect(question()).toBeNull();
    expect(top().querySelector<HTMLInputElement>('#name')?.value).toBe('Ion');
  });

  it('discarding the top task leaves the first one open and unasked', async () => {
    await openTask();
    click('#again');
    await settle();
    type('Ion');
    closeButton()?.click();
    await settle();

    const discard = [...(question()?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent?.trim() === text('shell.overlay.discard.discard'),
    );
    discard?.click();
    await settle();

    expect(dialogs()).toHaveLength(1);
    expect(question()).toBeNull();
    await expect(FormTask.inners[0]).resolves.toBe('cancelled');
  });

  it('a task that closes itself while the question is open takes the question with it', async () => {
    const { host } = await openTask();
    type('Ion');
    pressEscape();
    await settle();
    expect(question()).not.toBeNull();

    click('#saved');
    await settle();

    expect(dialogs()).toHaveLength(0);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await expect(host.results[0]).resolves.toBe('saved');
  });

  it('a click outside the top task leaves the one beneath unasked and open', async () => {
    await openTask();
    type('Ion');
    click('#again');
    await settle();

    clickOutside();
    await settle();

    expect(dialogs()).toHaveLength(1);
    expect(question()).toBeNull();
  });

  it('releases the scroll lock only after the last stacked task closes', async () => {
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 4000,
    });
    await openTask();
    click('#again');
    await settle();

    pressEscape();
    await settle();
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

describe('Overlays adversary: the same task twice', () => {
  it('gives each open its own result when opened twice in a row', async () => {
    const { host } = await openTask();
    document.querySelector<HTMLButtonElement>('#opener')?.click();
    await settle();
    expect(dialogs()).toHaveLength(2);

    click('#other');
    await settle();
    click('#saved');
    await settle();

    await expect(host.results[1]).resolves.toBe('other');
    await expect(host.results[0]).resolves.toBe('saved');
  });

  it('gives each of two open tasks its own data', async () => {
    const { host } = await openTask((h) => {
      h.options = {
        data: { greeting: 'one' },
        shape: 'dialog',
        title: 'shell.brand',
      };
    });
    host.options = {
      data: { greeting: 'two' },
      shape: 'dialog',
      title: 'shell.brand',
    };
    document.querySelector<HTMLButtonElement>('#opener')?.click();
    await settle();

    const greetings = dialogs().map(
      (d) => d.querySelector('#data')?.textContent,
    );
    expect(greetings).toEqual(['one', 'two']);
  });

  it('names each of two open tasks by a different title id', async () => {
    await openTask();
    document.querySelector<HTMLButtonElement>('#opener')?.click();
    await settle();

    const ids = dialogs().map((d) => d.getAttribute('aria-labelledby'));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
    }
  });
});

describe('Overlays adversary: a loader that fails', () => {
  it('keeps the panel, title and busy skeleton, and the X closes with cancelled', async () => {
    const { host } = await openTask((h) => {
      h.task = () => Promise.reject(new Error('chunk failed'));
    });

    expect(closeButton()).not.toBeNull();
    expect(
      top().querySelector('.mf-overlay-body')?.getAttribute('aria-busy'),
    ).toBe('true');

    closeButton()?.click();
    await settle();

    expect(dialogs()).toHaveLength(0);
    await expect(host.results[0]).resolves.toBe('cancelled');
  });

  it('Escape also closes a task whose loader failed', async () => {
    const { host } = await openTask((h) => {
      h.task = () => Promise.reject(new Error('chunk failed'));
    });

    pressEscape();
    await settle();

    expect(dialogs()).toHaveLength(0);
    await expect(host.results[0]).resolves.toBe('cancelled');
  });

  it('closes with cancelled when the user closes before a slow loader resolves', async () => {
    let arrive: (task: typeof FormTask) => void = () => {};
    const { host } = await openTask((h) => {
      h.task = () =>
        new Promise<typeof FormTask>((resolve) => {
          arrive = resolve;
        });
    });

    closeButton()?.click();
    await settle();
    arrive(FormTask);
    await settle();

    expect(dialogs()).toHaveLength(0);
    await expect(host.results[0]).resolves.toBe('cancelled');
  });
});

describe('Overlays adversary: confirmDiscard and data', () => {
  it.each([
    ['the X', () => closeButton()?.click()],
    ['Escape', pressEscape],
    ['a click outside', clickOutside],
  ])(
    'confirmDiscard false closes a changed task at once by %s',
    async (_, close) => {
      const { host } = await openTask((h) => {
        h.options = {
          confirmDiscard: false,
          shape: 'dialog',
          title: 'shell.brand',
        };
      });
      type('Ion');

      close();
      await settle();

      expect(dialogs()).toHaveLength(0);
      await expect(host.results[0]).resolves.toBe('cancelled');
    },
  );

  it('confirmDiscard true asks the same as leaving it out', async () => {
    await openTask((h) => {
      h.options = {
        confirmDiscard: true,
        shape: 'dialog',
        title: 'shell.brand',
      };
    });
    type('Ion');

    pressEscape();
    await settle();

    expect(question()).not.toBeNull();
  });

  it('passes an empty string through untouched', async () => {
    await openTask((h) => {
      h.options = {
        data: { greeting: '' },
        shape: 'drawer',
        title: 'shell.brand',
      };
    });

    expect(top().querySelector('#data')?.textContent).toBe('');
  });

  it('passes unicode data through', async () => {
    await openTask((h) => {
      h.options = {
        data: { greeting: 'Șoseaua Ștefan — 日本語 🚗' },
        shape: 'drawer-wide',
        title: 'shell.brand',
      };
    });

    expect(top().querySelector('#data')?.textContent).toBe(
      'Șoseaua Ștefan — 日本語 🚗',
    );
  });
});

describe('Overlays adversary: focus and history', () => {
  it('closes and leaves focus on a live element when the opener was removed', async () => {
    const { opener } = await openTask();
    opener?.remove();

    pressEscape();
    await settle();

    expect(dialogs()).toHaveLength(0);
    expect(document.body.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.id).not.toBe('opener');
  });

  it('resolves cancelled when the opener component was destroyed before the task closed', async () => {
    const { host, fixture } = await openTask();
    fixture.destroy();

    pressEscape();
    await settle();

    await expect(host.results[0]).resolves.toBe('cancelled');
  });

  it('returns focus to the control that opened the second task, not the page opener', async () => {
    const { opener } = await openTask();
    const again = top().querySelector<HTMLButtonElement>('#again');
    again?.focus();
    again?.click();
    await settle();

    click('#saved');
    await settle();

    expect(document.activeElement).toBe(again);
    expect(document.activeElement).not.toBe(opener);
  });

  it('adds one entry per open task and leaves none behind across open, stack, and close', async () => {
    history.pushState({ page: 'here' }, '');
    const length = history.length;
    const href = location.href;
    await openTask();
    click('#again');
    await settle();
    expect(history.length).toBe(length + 2);

    pressEscape();
    await settle();
    pressEscape();
    await settle();

    expect(history.state).toEqual({ page: 'here' });
    expect(location.href).toBe(href);
  });
});
