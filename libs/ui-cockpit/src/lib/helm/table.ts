import { Directive, input } from '@angular/core';

@Directive({
  host: { class: 'spartan-table-container', 'data-slot': 'table-container' },
  selector: 'div[hlmTableContainer]',
})
export class HlmTableContainer {}

@Directive({
  host: { class: 'spartan-table', 'data-slot': 'table' },
  selector: 'table[hlmTable]',
})
export class HlmTable {}

@Directive({
  host: { class: 'spartan-table-header', 'data-slot': 'table-header' },
  selector: 'thead[hlmTHead]',
})
export class HlmTHead {}

@Directive({
  host: { class: 'spartan-table-body', 'data-slot': 'table-body' },
  selector: 'tbody[hlmTBody]',
})
export class HlmTBody {}

@Directive({
  host: { class: 'spartan-table-row', 'data-slot': 'table-row' },
  selector: 'tr[hlmTr]',
})
export class HlmTr {}

// On a phone a table that names a main column shows only main and key.
type Column = 'main' | 'key';

@Directive({
  host: {
    '[attr.data-column]': 'column()',
    class: 'spartan-table-head',
    'data-slot': 'table-head',
  },
  selector: 'th[hlmTh]',
})
export class HlmTh {
  readonly column = input<Column>();
}

@Directive({
  host: {
    '[attr.data-column]': 'column()',
    class: 'spartan-table-cell',
    'data-slot': 'table-cell',
  },
  selector: 'td[hlmTd]',
})
export class HlmTd {
  readonly column = input<Column>();
}

export const HlmTableImports = [
  HlmTableContainer,
  HlmTable,
  HlmTHead,
  HlmTBody,
  HlmTr,
  HlmTh,
  HlmTd,
] as const;
