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
});
