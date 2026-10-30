import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import {
  DashboardSectionsPanel,
  type PanelRow,
  type SectionsPanelData,
} from './dashboard-sections-panel';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

const read = (...parts: string[]) =>
  readFileSync(join(__dirname, ...parts), 'utf8');
const cockpit = read(
  '../../../../../../libs/ui-cockpit/src/styles/cockpit.css',
);
const panelSheet = read('dashboard-sections-panel.css');
const stripSheet = read('../admin-panel/admin-panel.css');
// The body of the first rule whose selector matches, comments dropped.
const ruleOf = (sheet: string, selector: RegExp) => {
  const plain = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = plain.search(selector);
  if (at < 0) return '';
  const open = plain.indexOf('{', at);
  return plain.slice(open + 1, plain.indexOf('}', open));
};

afterEach(() => {
  document.body.innerHTML = '';
});

// @traces 1391-FR-012
describe('the panel and the strip at a thumb’s size', () => {
  it('draws every control of the panel as a button the 44 px rule covers', async () => {
    const rows = signal<readonly PanelRow[]>([
      {
        description: 'A',
        key: 'numbers',
        name: 'Cifre',
        position: 1,
        shown: true,
      },
      {
        description: 'B',
        key: 'log',
        name: 'Jurnal',
        position: 2,
        shown: false,
      },
    ]);
    await TestBed.inject(I18n).enter('admin');
    const host = TestBed.createComponent(Host);
    host.componentInstance.overlays.open<'done', SectionsPanelData>(
      DashboardSectionsPanel,
      {
        confirmDiscard: false,
        data: {
          messages: 'admin.panel.sections',
          move: async () => true,
          reset: async () => true,
          rows,
          toggle: async () => true,
        },
        shape: 'drawer',
        title: 'admin.panel.sections.title',
      },
    );
    await settle();

    const panel = document.querySelector('mf-dashboard-sections-panel');
    const controls = [
      ...(panel?.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, [role="switch"], [tabindex]:not([tabindex="-1"])',
      ) ?? []),
    ];
    // Two switches, four moves, reset and done.
    expect(controls.length).toBeGreaterThanOrEqual(8);
    for (const control of controls) {
      expect(control.tagName).toBe('BUTTON');
    }
    expect(panel?.querySelectorAll('button[role="switch"]')).toHaveLength(2);
  });

  it('keeps the tap token at 44 px and every button, switch and move at least that tall', () => {
    expect(ruleOf(cockpit, /:root\s*\{/)).toMatch(/--mf-tap:\s*44px/);
    const phone = ruleOf(cockpit, /:where\(\s*button,/);
    expect(phone).toMatch(/min-height:\s*var\(--mf-tap\)/);
    expect(cockpit).toMatch(/:where\(\s*button,[^)]*\[role="switch"\]/);
    expect(ruleOf(cockpit, /\.spartan-button\s*\{/)).toMatch(
      /min-height:\s*var\(--mf-tap\)/,
    );
    expect(ruleOf(cockpit, /button\.spartan-switch\s*\{/)).toMatch(
      /min-height:\s*var\(--mf-tap\)/,
    );
    const moves = ruleOf(panelSheet, /\.moves button\s*\{/);
    expect(moves).toMatch(/min-height:\s*var\(--mf-tap\)/);
    expect(moves).toMatch(/min-width:\s*var\(--mf-tap\)/);
    // Nothing in the panel sets a control shorter, and the strip leaves its
    // button to the kit: no rule of its own reaches it.
    expect(panelSheet).not.toMatch(/height:\s*(?:[0-3]?\d|4[0-3])px/);
    expect(stripSheet).not.toMatch(/\.strip\s+button|\[data-customise\]/);
    for (const selector of [/\.strip\s*\{/, /\.count\s*\{/]) {
      expect(ruleOf(stripSheet, selector)).not.toMatch(/height/);
    }
  });

  it('opens and closes the panel without its slide under a reduced-motion setting', () => {
    const at = cockpit.search(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*,/,
    );
    expect(at).toBeGreaterThanOrEqual(0);
    const reduce = ruleOf(
      cockpit.slice(at),
      /\*,\s*\*::before,\s*\*::after\s*\{/,
    );
    expect(reduce).toMatch(/animation:\s*none !important/);
    expect(reduce).toMatch(/transition:\s*none !important/);
    // The panel adds no motion of its own that the rule would miss.
    expect(panelSheet).not.toMatch(/animation|transition/);
  });
});
