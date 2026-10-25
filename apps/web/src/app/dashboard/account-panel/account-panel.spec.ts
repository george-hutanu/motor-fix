import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { AccountPanel } from './account-panel';
import en from '../../../../../../libs/i18n/src/shell/en.json';
import ro from '../../../../../../libs/i18n/src/shell/ro.json';
import { DataExport } from '../data-export/data-export';
import { DeleteAccount } from '../delete-account/delete-account';

// @traces 140-FR-015

@Component({ selector: 'mf-data-export', template: '' })
class FakeDataExport {}

@Component({ selector: 'mf-delete-account', template: '' })
class FakeDeleteAccount {
  readonly inPanel = input(false);
}

async function render(language: 'ro' | 'en' = 'ro') {
  TestBed.overrideComponent(AccountPanel, {
    add: { imports: [FakeDataExport, FakeDeleteAccount] },
    remove: { imports: [DataExport, DeleteAccount] },
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(AccountPanel);
  fixture.detectChanges();
  return fixture;
}

describe('the "Contul tău" panel', () => {
  it('heads the panel, says what it holds, then the export and the delete row in the panel', async () => {
    const fixture = await render();
    const element = fixture.nativeElement as HTMLElement;

    const section = element.querySelector('section') as HTMLElement;
    const title = section.querySelector('h2') as HTMLElement;
    expect(title.textContent?.trim()).toBe(ro.accountPanel.title);
    expect(section.getAttribute('aria-labelledby')).toBe(title.id);
    expect(section.querySelector('p')?.textContent?.trim()).toBe(
      ro.accountPanel.text,
    );
    expect(
      [...section.querySelectorAll('mf-data-export, mf-delete-account')].map(
        (child) => child.tagName.toLowerCase(),
      ),
    ).toEqual(['mf-data-export', 'mf-delete-account']);

    const row = fixture.debugElement.query(
      (node) => node.componentInstance instanceof FakeDeleteAccount,
    ).componentInstance as FakeDeleteAccount;
    expect(row.inPanel()).toBe(true);
  });

  it('reads English', async () => {
    const element = (await render('en')).nativeElement as HTMLElement;

    expect(element.querySelector('h2')?.textContent?.trim()).toBe(
      en.accountPanel.title,
    );
    expect(element.querySelector('p')?.textContent?.trim()).toBe(
      en.accountPanel.text,
    );
  });
});
