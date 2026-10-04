import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';

import {
  HlmButton,
  HlmDialogImports,
  HlmInput,
  HlmLabel,
  HlmPopoverImports,
  HlmSheetImports,
  HlmSwitch,
  HlmTableImports,
  HlmTabsImports,
  HlmToaster,
  Panel,
  toast,
} from './index';

const css = readFileSync(join(__dirname, 'styles/cockpit.css'), 'utf8');

@Component({
  imports: [
    FormsModule,
    HlmButton,
    HlmInput,
    HlmLabel,
    HlmSwitch,
    HlmTableImports,
    HlmTabsImports,
    HlmDialogImports,
    HlmSheetImports,
    HlmPopoverImports,
    HlmToaster,
    Panel,
  ],
  template: `
    <a hlmBtn id="link" href="/x">Link</a>
    <button hlmBtn id="dyn" [variant]="variant()">Dyn</button>
    <button hlmBtn id="bad" variant="bogus">Bad</button>
    <button hlmBtn id="dis" disabled>Dis</button>

    <input hlmInput id="field" [(ngModel)]="text" />
    <input hlmInput id="ro" readonly value="x" />
    <input hlmInput id="offfield" disabled />

    <hlm-switch inputId="sw" [(ngModel)]="on" />
    <hlm-switch inputId="sw2" [ngModel]="true" />
    <hlm-switch inputId="sw3" [ngModel]="false" [disabled]="true" />
    <hlm-switch inputId="sw4" [(ngModel)]="on" aria-label="Notificări" />

    <div hlmTabs [tab]="tab()" id="tabs">
      <div hlmTabsList>
        <button hlmTabsTrigger="a" id="ta">A</button>
        <button hlmTabsTrigger="b" id="tb">B</button>
        <button hlmTabsTrigger="c" id="tc">C</button>
      </div>
      <div hlmTabsContent="a" id="ca">pa</div>
      <div hlmTabsContent="b" id="cb">pb</div>
      <div hlmTabsContent="c" id="cc">pc</div>
    </div>

    <div hlmTableContainer>
      <table hlmTable>
        <tbody hlmTBody>
          <tr hlmTr id="sel" data-state="selected"><td hlmTd>x</td></tr>
          <tr hlmTr id="plain"><td hlmTd>y</td></tr>
        </tbody>
      </table>
    </div>

    <hlm-dialog>
      <button hlmDialogTrigger id="dtrig">open</button>
      <hlm-dialog-content *hlmDialogPortal="let ctx" closeLabel="Închide">
        <hlm-dialog-header>
          <h2 hlmDialogTitle>Titlu ăâîșț</h2>
        </hlm-dialog-header>
        <p>corp</p>
      </hlm-dialog-content>
    </hlm-dialog>

    <hlm-sheet side="left">
      <button hlmSheetTrigger id="strig">open</button>
      <hlm-sheet-content *hlmSheetPortal="let ctx" closeLabel="">
        <hlm-sheet-header><h2 hlmSheetTitle>Sertar</h2></hlm-sheet-header>
      </hlm-sheet-content>
    </hlm-sheet>

    <hlm-popover>
      <button hlmPopoverTrigger id="ptrig">open</button>
      <hlm-popover-content *hlmPopoverPortal="let ctx">
        <p>pop</p>
      </hlm-popover-content>
    </hlm-popover>

    <mf-panel title="T"><span id="inner">in</span></mf-panel>
    <hlm-toaster />
  `,
})
class Host {
  readonly variant = signal<'default' | 'secondary' | 'ghost'>('default');
  readonly text = signal('');
  readonly on = signal(false);
  readonly tab = signal('a');
}

async function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  await fixture.whenStable();
  const page = fixture.nativeElement as HTMLElement;
  const q = <T extends Element = HTMLElement>(s: string) =>
    page.querySelector<T & Element>(s) as T;
  return { fixture, page, q };
}

async function settle(fixture: {
  detectChanges(): void;
  whenStable(): Promise<unknown>;
}) {
  fixture.detectChanges();
  await fixture.whenStable();
  await new Promise((r) => setTimeout(r, 0));
  fixture.detectChanges();
  await fixture.whenStable();
}

afterEach(() => {
  document.body.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
});

describe('helm button misuse', () => {
  it('gives an anchor the same button classes as a button', async () => {
    const { q } = await render();

    expect(q('#link').classList).toContain('spartan-button');
    expect(q('#link').classList).toContain('spartan-button-variant-default');
  });

  it('swaps the variant class when the variant changes after render', async () => {
    const { fixture, q } = await render();

    fixture.componentInstance.variant.set('ghost');
    await settle(fixture);

    expect(q('#dyn').classList).toContain('spartan-button-variant-ghost');
    expect(q('#dyn').classList).not.toContain('spartan-button-variant-default');
  });

  it('never carries two variant classes at once, even for an unknown variant', async () => {
    const { q } = await render();

    const variants = [...q('#bad').classList].filter((c) =>
      c.startsWith('spartan-button-variant-'),
    );
    expect(variants.length).toBeLessThanOrEqual(1);
    expect(variants).not.toContain('spartan-button-variant-secondary');
    expect(variants).not.toContain('spartan-button-variant-ghost');
  });

  it('does not mark a disabled anchor-less button as amber-clickable', async () => {
    const { q } = await render();

    expect(q<HTMLButtonElement>('#dis').disabled).toBe(true);
  });
});

describe('helm input misuse', () => {
  it('shows a model value that was set before the first render', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.text.set('Țiriac');
    fixture.detectChanges();
    await fixture.whenStable();

    const input = fixture.nativeElement.querySelector(
      '#field',
    ) as HTMLInputElement;
    expect(input.value).toBe('Țiriac');
  });

  it('keeps Romanian and astral characters intact through the model', async () => {
    const { fixture, q } = await render();
    const input = q<HTMLInputElement>('#field');
    const value = 'ăâîșț 🚗 \u0000x';

    input.value = value;
    input.dispatchEvent(new Event('input'));

    expect(fixture.componentInstance.text()).toBe(value);
  });

  it('keeps a ten thousand character value whole', async () => {
    const { fixture, q } = await render();
    const input = q<HTMLInputElement>('#field');
    const value = 'ș'.repeat(10000);

    input.value = value;
    input.dispatchEvent(new Event('input'));

    expect(fixture.componentInstance.text()).toHaveLength(10000);
  });

  it('puts the input class on read-only and disabled fields too', async () => {
    const { q } = await render();

    expect(q('#ro').classList).toContain('spartan-input');
    expect(q<HTMLInputElement>('#offfield').disabled).toBe(true);
    expect(q('#offfield').classList).toContain('spartan-input');
  });
});

describe('helm switch misuse', () => {
  it('starts on when the model starts true', async () => {
    const { fixture, q } = await render();
    await settle(fixture);
    const sw = q('#sw2');

    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.getAttribute('data-state')).toBe('checked');
  });

  it('ignores a click while disabled and leaves it off', async () => {
    const { fixture, q } = await render();
    await settle(fixture);
    const sw = q<HTMLButtonElement>('#sw3');

    sw.click();

    expect(sw.disabled).toBe(true);
    expect(sw.getAttribute('aria-checked')).toBe('false');
  });

  it('returns to off after two clicks', async () => {
    const { fixture, q } = await render();
    const sw = q<HTMLButtonElement>('#sw');

    sw.click();
    fixture.detectChanges();
    sw.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.on()).toBe(false);
    expect(sw.getAttribute('aria-checked')).toBe('false');
  });

  it('forwards an aria label to the switch button', async () => {
    const { q } = await render();

    expect(q('#sw4').getAttribute('aria-label')).toBe('Notificări');
  });

  it('follows a model change made from code', async () => {
    const { fixture, q } = await render();

    fixture.componentInstance.on.set(true);
    await settle(fixture);

    expect(q('#sw').getAttribute('aria-checked')).toBe('true');
  });
});

describe('helm tabs misuse', () => {
  it('selects the trigger whose value matches the tab input and shows only its panel', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.tab.set('c');
    fixture.detectChanges();
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;

    const tabs = [...page.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual([
      'false',
      'false',
      'true',
    ]);
    expect(
      page.querySelectorAll('[role="tabpanel"]:not([hidden])'),
    ).toHaveLength(1);
    expect(
      page.querySelector('[role="tabpanel"]:not([hidden])')?.textContent,
    ).toContain('pc');
  });

  it('moves selection on click and hides the previous panel', async () => {
    const { fixture } = await render();

    const tabs = () =>
      [
        ...fixture.nativeElement.querySelectorAll('[role="tab"]'),
      ] as HTMLElement[];
    tabs()[1].click();
    await settle(fixture);

    expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(tabs()[1].getAttribute('data-state')).toBe('active');
    expect(tabs()[0].getAttribute('data-state')).not.toBe('active');
    expect(
      fixture.nativeElement.querySelector('[role="tabpanel"]:not([hidden])')
        .textContent,
    ).toContain('pb');
    expect(
      fixture.nativeElement.querySelectorAll('[role="tabpanel"]:not([hidden])'),
    ).toHaveLength(1);
  });

  it('keeps exactly one tab in the tab order', async () => {
    const { page } = await render();
    const stops = [...page.querySelectorAll('[role="tab"]')].filter(
      (t) => t.getAttribute('tabindex') === '0',
    );

    expect(stops).toHaveLength(1);
  });
});

describe('helm table selected row', () => {
  it('leaves rows without the selected state unmarked', async () => {
    const { q } = await render();

    expect(q('#sel').getAttribute('data-state')).toBe('selected');
    expect(q('#plain').hasAttribute('data-state')).toBe(false);
  });
});

describe('helm dialog', () => {
  it('opens on trigger click with a labelled dialog and closes through its close button', async () => {
    const { fixture, q } = await render();
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    q<HTMLButtonElement>('#dtrig').click();
    await settle(fixture);
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;

    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('Titlu ăâîșț');
    const close = dialog.querySelector('button') as HTMLButtonElement;
    expect(close.getAttribute('aria-label') ?? close.textContent).toContain(
      'Închide',
    );

    close.click();
    await settle(fixture);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('closes on Escape', async () => {
    const { fixture, q } = await render();
    q<HTMLButtonElement>('#dtrig').click();
    await settle(fixture);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle(fixture);

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('reports nothing when its close label is given', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { fixture, q } = await render();

    q<HTMLButtonElement>('#dtrig').click();
    await settle(fixture);

    expect(error).not.toHaveBeenCalledWith(
      expect.stringContaining('hlm-dialog-content'),
    );
    error.mockRestore();
  });

  it('in dev mode, reports a blank close label by name', async () => {
    @Component({
      imports: [HlmDialogImports],
      template: `
        <hlm-dialog>
          <button hlmDialogTrigger id="blank">open</button>
          <hlm-dialog-content *hlmDialogPortal="let ctx" closeLabel="   ">
            <p>corp</p>
          </hlm-dialog-content>
        </hlm-dialog>
      `,
    })
    class BlankLabel {}
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const fixture = TestBed.createComponent(BlankLabel);
    await settle(fixture);

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('#blank')
      ?.click();
    await settle(fixture);

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('hlm-dialog-content'),
    );
    error.mockRestore();
  });

  it('opens only one dialog after the trigger is clicked twice', async () => {
    const { fixture, q } = await render();

    q<HTMLButtonElement>('#dtrig').click();
    await settle(fixture);
    q<HTMLButtonElement>('#dtrig').click();
    await settle(fixture);

    expect(
      document.querySelectorAll('[role="dialog"]').length,
    ).toBeLessThanOrEqual(1);
  });
});

describe('helm sheet', () => {
  it('opens as a dialog and, in dev mode, reports its empty close label by name', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { fixture, q } = await render();

    q<HTMLButtonElement>('#strig').click();
    await settle(fixture);
    const sheet = document.querySelector('[role="dialog"]') as HTMLElement;

    expect(sheet).not.toBeNull();
    expect(sheet.textContent).toContain('Sertar');
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('hlm-sheet-content'),
    );
    error.mockRestore();
  });

  it('carries the side it was given on the panel', async () => {
    const { fixture, q } = await render();

    q<HTMLButtonElement>('#strig').click();
    await settle(fixture);
    const sheet = document.querySelector('[role="dialog"]') as HTMLElement;

    const marked = [sheet, ...sheet.querySelectorAll('*')].some(
      (e) =>
        e.getAttribute('data-side') === 'left' ||
        /left/.test(e.className?.toString() ?? ''),
    );
    expect(marked).toBe(true);
  });
});

describe('helm popover', () => {
  it('opens its content on trigger click and closes on a second click', async () => {
    const { fixture, q } = await render();

    q<HTMLButtonElement>('#ptrig').click();
    await settle(fixture);
    expect(document.body.textContent).toContain('pop');
    expect(q('#ptrig').getAttribute('aria-expanded')).toBe('true');

    q<HTMLButtonElement>('#ptrig').click();
    await settle(fixture);
    expect(q('#ptrig').getAttribute('aria-expanded')).toBe('false');
  });
});

describe('toaster', () => {
  it('shows a toast title and description and renders one toaster region', async () => {
    const { fixture, page } = await render();

    toast('Salvat ăț', { description: 'Detalii' });
    await settle(fixture);

    expect(page.querySelectorAll('hlm-toaster')).toHaveLength(1);
    expect(document.body.textContent).toContain('Salvat ăț');
    expect(document.body.textContent).toContain('Detalii');
  });

  it('shows a toast with an empty title without throwing', async () => {
    const { fixture } = await render();

    expect(() => toast('')).not.toThrow();
    await settle(fixture);
    expect(
      document.body.querySelectorAll('[data-sonner-toast]').length,
    ).toBeGreaterThan(0);
  });

  it('shows many toasts at once', async () => {
    const { fixture } = await render();

    for (let i = 0; i < 20; i++) toast(`msg ${i}`);
    await settle(fixture);

    expect(document.body.textContent).toContain('msg 19');
  });
});

describe('panel through the public entry point', () => {
  it('projects its content and names the section by its title', async () => {
    const { q } = await render();

    expect(q('mf-panel #inner').textContent).toBe('in');
    expect(q('mf-panel h2').textContent?.trim()).toBe('T');
  });
});

describe('every style hook the helm parts render has a rule', () => {
  it('finds each rendered spartan class in the stylesheet', async () => {
    const { fixture, page } = await render();
    for (const id of ['#dtrig', '#strig', '#ptrig'])
      page.querySelector<HTMLButtonElement>(id)?.click();
    await settle(fixture);

    const elements = [
      ...page.querySelectorAll('*'),
      ...document.querySelectorAll('.cdk-overlay-container *'),
    ];
    const used = new Set(
      elements
        .flatMap((el) => [...el.classList])
        .filter((c) => c.startsWith('spartan-')),
    );

    const missing = [...used].filter((c) => !css.includes(`.${c}`));
    expect(used.size).toBeGreaterThanOrEqual(15);
    expect(missing).toEqual([]);
  });
});

describe('stylesheet size promises', () => {
  const declarations = (prop: string) =>
    [
      ...css.matchAll(new RegExp(`(?<![-\\w])${prop}\\s*:\\s*([^;]+);`, 'g')),
    ].map((m) => m[1].trim());

  it('declares no literal font size below 12px', () => {
    const small = declarations('font-size').filter((v) => {
      const m = /^([\d.]+)(px|rem|em)$/.exec(v);
      if (!m) return false;
      const n = Number(m[1]) * (m[2] === 'px' ? 1 : 16);
      return n < 12;
    });

    expect(small).toEqual([]);
  });

  it('never redefines a size token inside a width media query', () => {
    const queries = [
      ...css.matchAll(/@media[^{]*\((?:max|min)-width[^{]*\{([\s\S]*?\n\})/g),
    ];
    const redefined = queries.filter((m) => /--mf-size-/.test(m[1]));

    expect(redefined).toEqual([]);
  });

  it('keeps the label size token at 12px or more and the field size at 16px or more', () => {
    const size = (name: string) =>
      Number(new RegExp(`${name}\\s*:\\s*([\\d.]+)px`).exec(css)?.[1]);

    expect(size('--mf-size-label')).toBeGreaterThanOrEqual(12);
    expect(size('--mf-size-small')).toBeGreaterThanOrEqual(13);
    expect(size('--mf-size-field')).toBeGreaterThanOrEqual(16);
  });

  it('gives buttons, inputs, tab triggers and the switch the 44px tap height', () => {
    for (const cls of [
      'spartan-button',
      'spartan-input',
      'spartan-tabs-trigger',
      'spartan-switch',
    ]) {
      const block = new RegExp(
        `\\.${cls}(?![\\w-])[^{]*\\{[^}]*min-height:\\s*var\\(--mf-tap\\)`,
      ).test(css);
      expect({ block, cls }).toEqual({ block: true, cls });
    }
  });

  it('sets no pixel height under 44px on a tappable control', () => {
    const heights = [
      ...css.matchAll(
        /\.spartan-(?:button|input|tabs-trigger|switch)(?![\w-])[^{]*\{([^}]*)\}/g,
      ),
    ]
      .flatMap((m) => [
        ...m[1].matchAll(/(?<![-\w])(?:max-)?height:\s*(\d+)px/g),
      ])
      .map((m) => Number(m[1]));

    expect(heights.filter((h) => h < 44)).toEqual([]);
  });

  it('never switches off the focus outline or the forced colours adjustment', () => {
    const forced =
      /@media\s*\(forced-colors:\s*active\)\s*\{([\s\S]*?)\n\}/.exec(
        css,
      )?.[1] ?? '';

    expect(forced).not.toMatch(/forced-color-adjust:\s*none/);
    expect(css).not.toMatch(/outline\s*:\s*(none|0)\s*[;!]/);
    expect(css).not.toMatch(/outline-style\s*:\s*none/);
  });

  it('uses the light tokens for print', () => {
    expect(css).toMatch(
      /@media[^{]*prefers-color-scheme:\s*light[^{]*,\s*print\s*\{/,
    );
  });

  it('imports both self-hosted font packages, each declaring swap and Latin Extended', () => {
    const base = join(__dirname, '../../../node_modules');
    const pkgs = [
      ['@fontsource/michroma', /@fontsource\/michroma\/index\.css/],
      [
        '@fontsource-variable/hanken-grotesk',
        /@fontsource-variable\/hanken-grotesk\/index\.css/,
      ],
    ] as const;

    for (const [pkg, imp] of pkgs) {
      expect(css).toMatch(imp);
      const faces = readFileSync(join(base, pkg, 'index.css'), 'utf8');
      expect(faces).toMatch(/font-display:\s*swap/);
      expect(faces).toMatch(/latin-ext/);
      expect(faces).not.toMatch(
        /font-display:\s*(block|auto|fallback|optional)/,
      );
    }
  });

  it('falls back from both families to the system sans-serif', () => {
    expect(css).toMatch(/--mf-font-body:[^;]*sans-serif/);
    expect(css).toMatch(/--mf-font-label:[^;]*Hanken[^;]*sans-serif/);
  });
});
