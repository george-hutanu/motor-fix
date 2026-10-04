import { ChangeDetectionStrategy, Component } from '@angular/core';

// The close cross of dialogs and drawers, drawn in the text colour.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'mf-close-icon',
  template: `
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-width="2"
      viewBox="0 0 24 24"
      width="20"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  `,
})
export class CloseIcon {}
