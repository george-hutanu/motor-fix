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

const switchOf = (key: string) =>
  [
    ...(document
      .querySelector('mf-dashboard-sections-panel')
      ?.querySelectorAll<HTMLElement>('[data-row]') ?? []),
  ]
    .find((each) => each.getAttribute('data-key') === key)
    ?.querySelector<HTMLButtonElement>(
      'button[role="switch"]',
    ) as HTMLButtonElement;

afterEach(() => {
  document.body.innerHTML = '';
});

// @traces 1391-FR-009
describe('a switch whose save is out', () => {
  it('gives focus back to the switch once its save answers', async () => {
    const rows = signal<readonly PanelRow[]>([
      {
        description: 'Pe scurt',
        key: 'log',
        name: 'Jurnal',
        position: 1,
        shown: true,
      },
    ]);
    let answer: (saved: boolean) => void = () => undefined;
    await TestBed.inject(I18n).enter('admin');
    const host = TestBed.createComponent(Host);
    host.componentInstance.overlays.open<'done', SectionsPanelData>(
      DashboardSectionsPanel,
      {
        confirmDiscard: false,
        data: {
          messages: 'admin.panel.sections',
          rows,
          toggle: (key, shown) =>
            new Promise<boolean>((resolve) => {
              rows.update((each) =>
                each.map((one) => (one.key === key ? { ...one, shown } : one)),
              );
              answer = resolve;
            }),
        },
        shape: 'drawer',
        title: 'admin.panel.sections.title',
      },
    );
    await settle();

    switchOf('log').focus();
    switchOf('log').click();
    await settle();
    expect(switchOf('log').disabled).toBe(true);
    // A browser drops the focus of a control that becomes disabled.
    switchOf('log').blur();

    answer(true);
    await settle();
    expect(switchOf('log').disabled).toBe(false);
    expect(document.activeElement).toBe(switchOf('log'));
  });
});
