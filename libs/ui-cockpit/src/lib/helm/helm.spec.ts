import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';

import { HlmButton } from './button';
import { HlmInput } from './input';
import { HlmLabel } from './label';
import { HlmSwitch } from './switch';
import { HlmTableImports } from './table';
import { HlmTabsImports } from './tabs';

@Component({
  imports: [
    FormsModule,
    HlmButton,
    HlmInput,
    HlmLabel,
    HlmSwitch,
    HlmTableImports,
    HlmTabsImports,
  ],
  template: `
    <button hlmBtn id="main">Caută</button>
    <button hlmBtn id="second" variant="secondary">Anulează</button>
    <button hlmBtn id="quiet" variant="ghost">Mai mult</button>
    <button hlmBtn id="off" disabled>Oprit</button>

    <label hlmLabel for="brand">Marca</label>
    <input hlmInput id="brand" [(ngModel)]="brand" aria-describedby="brand-help" />

    <hlm-switch inputId="open" [(ngModel)]="open" />

    <div hlmTabs tab="all">
      <div hlmTabsList>
        <button hlmTabsTrigger="all">Toate</button>
        <button hlmTabsTrigger="open">Deschise</button>
      </div>
      <div hlmTabsContent="all">toate</div>
      <div hlmTabsContent="open">deschise</div>
    </div>

    <div hlmTableContainer>
      <table hlmTable>
        <thead hlmTHead>
          <tr hlmTr><th hlmTh>Service</th></tr>
        </thead>
        <tbody hlmTBody>
          <tr hlmTr><td hlmTd>Atelier</td></tr>
        </tbody>
      </table>
    </div>
  `,
})
class Host {
  readonly brand = signal('');
  readonly open = signal(false);
}

async function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  await fixture.whenStable();
  const page = fixture.nativeElement as HTMLElement;
  const q = <T extends Element = HTMLElement>(selector: string) =>
    page.querySelector<T & Element>(selector) as T;
  return { fixture, page, q };
}

describe('helm button', () => {
  it('is the amber main action by default', async () => {
    const { q } = await render();

    expect(q('#main').getAttribute('data-slot')).toBe('button');
    expect(q('#main').classList).toContain('spartan-button');
    expect(q('#main').classList).toContain('spartan-button-variant-default');
  });

  it('switches to the secondary and ghost looks by variant only', async () => {
    const { q } = await render();

    expect(q('#second').classList).toContain(
      'spartan-button-variant-secondary',
    );
    expect(q('#second').classList).not.toContain(
      'spartan-button-variant-default',
    );
    expect(q('#quiet').classList).toContain('spartan-button-variant-ghost');
  });

  it('offers no size variant', async () => {
    const { q } = await render();

    for (const id of ['#main', '#second', '#quiet']) {
      expect([...q(id).classList].filter((c) => c.includes('-size-'))).toEqual(
        [],
      );
    }
  });

  it('passes disabled to the native button', async () => {
    const { q } = await render();

    expect(q<HTMLButtonElement>('#off').disabled).toBe(true);
  });
});

describe('helm input and label', () => {
  it('styles the field and keeps the label pointing at it', async () => {
    const { q } = await render();
    const input = q<HTMLInputElement>('#brand');

    expect(input.classList).toContain('spartan-input');
    expect(input.getAttribute('data-slot')).toBe('input');
    expect(q('label').classList).toContain('spartan-label');
    expect(q('label').getAttribute('for')).toBe('brand');
  });

  it('binds its value through forms', async () => {
    const { fixture, q } = await render();
    const input = q<HTMLInputElement>('#brand');

    input.value = 'Dacia';
    input.dispatchEvent(new Event('input'));

    expect(fixture.componentInstance.brand()).toBe('Dacia');
  });
});

describe('helm input description', () => {
  it("keeps the field's own aria-describedby", async () => {
    const { q } = await render();

    expect(q<HTMLInputElement>('#brand').getAttribute('aria-describedby')).toBe(
      'brand-help',
    );
  });
});

describe('helm switch', () => {
  it('renders a switch button with the Cockpit classes', async () => {
    const { q } = await render();
    const button = q('button[role="switch"]');

    expect(button.classList).toContain('spartan-switch');
    expect(button.id).toBe('open');
    expect(button.querySelector('.spartan-switch-thumb')).not.toBeNull();
    expect(button.getAttribute('data-state')).toBe('unchecked');
  });

  it('turns on when clicked and reports it through forms', async () => {
    const { fixture, q } = await render();
    const button = q<HTMLButtonElement>('button[role="switch"]');

    button.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.open()).toBe(true);
    expect(button.getAttribute('data-state')).toBe('checked');
    expect(button.getAttribute('aria-checked')).toBe('true');
  });
});

describe('helm tabs', () => {
  it('marks exactly the active trigger selected and styles every trigger', async () => {
    const { page } = await render();
    const tabs = [...page.querySelectorAll('[role="tab"]')];

    expect(tabs).toHaveLength(2);
    for (const tab of tabs)
      expect(tab.classList).toContain('spartan-tabs-trigger');
    expect(
      tabs.filter((t) => t.getAttribute('aria-selected') === 'true'),
    ).toHaveLength(1);
    expect(tabs[0].getAttribute('data-state')).toBe('active');
    expect(page.querySelector('[role="tablist"]')?.classList).toContain(
      'spartan-tabs-list',
    );
  });
});

describe('helm table', () => {
  it('puts its class on every table part', async () => {
    const { q } = await render();

    expect(q('div[hlmTableContainer]').classList).toContain(
      'spartan-table-container',
    );
    expect(q('table').classList).toContain('spartan-table');
    expect(q('thead').classList).toContain('spartan-table-header');
    expect(q('tbody').classList).toContain('spartan-table-body');
    expect(q('tr').classList).toContain('spartan-table-row');
    expect(q('th').classList).toContain('spartan-table-head');
    expect(q('td').classList).toContain('spartan-table-cell');
  });
});
