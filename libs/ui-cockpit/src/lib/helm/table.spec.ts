import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { HlmTableImports } from './table';

@Component({
  imports: [HlmTableImports],
  template: `
    <table hlmTable>
      <thead hlmTHead>
        <tr hlmTr>
          <th hlmTh column="main">Service</th>
          <th hlmTh>Zona</th>
          <th hlmTh column="key">Nota</th>
        </tr>
      </thead>
      <tbody hlmTBody>
        <tr hlmTr>
          <td hlmTd column="main">Atelier Dinamo</td>
          <td hlmTd>Militari</td>
          <td hlmTd column="key">4,9</td>
        </tr>
      </tbody>
    </table>
  `,
})
class Host {}

describe('helm table columns', () => {
  it('marks the main and key columns and leaves the others unnamed', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const columns = (selector: string) =>
      [...fixture.nativeElement.querySelectorAll(selector)].map((cell) =>
        (cell as HTMLElement).getAttribute('data-column'),
      );

    expect(columns('th')).toEqual(['main', null, 'key']);
    expect(columns('td')).toEqual(['main', null, 'key']);
  });

  // @traces 461-FR-001
  // The phone stylesheet turns the table, body and rows into block and flex
  // boxes; explicit roles keep them a table for WebKit's accessibility tree.
  it('gives every table element its explicit role', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const role = (selector: string) =>
      [...fixture.nativeElement.querySelectorAll(selector)].map((el) =>
        (el as HTMLElement).getAttribute('role'),
      );

    expect(role('table')).toEqual(['table']);
    expect(role('thead')).toEqual(['rowgroup']);
    expect(role('tbody')).toEqual(['rowgroup']);
    expect(role('tr')).toEqual(['row', 'row']);
    expect(role('th')).toEqual([
      'columnheader',
      'columnheader',
      'columnheader',
    ]);
    expect(role('td')).toEqual(['cell', 'cell', 'cell']);
  });

  it('lets a screen reader name each cell of a list row by its column', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const headers = [
      ...host.querySelectorAll('[role="table"] [role="columnheader"]'),
    ];
    const row = host.querySelector(
      '[role="rowgroup"] + [role="rowgroup"] [role="row"]',
    );
    const named = [...(row?.querySelectorAll('[role="cell"]') ?? [])].map(
      (cell, i) => [headers[i]?.textContent?.trim(), cell.textContent?.trim()],
    );

    expect(named).toEqual([
      ['Service', 'Atelier Dinamo'],
      ['Zona', 'Militari'],
      ['Nota', '4,9'],
    ]);
  });
});
