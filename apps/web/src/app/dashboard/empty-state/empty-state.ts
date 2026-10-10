import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@motor-fix/i18n';

export type EmptyIcon =
  | 'car'
  | 'search'
  | 'quote'
  | 'wrench'
  | 'bookmark'
  | 'star'
  | 'inbox';

// One stroke path per icon, drawn in a 24 × 24 box.
const PATHS: Record<EmptyIcon, string> = {
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  car: 'M3 16v-4l2-5h14l2 5v4h-2a2 2 0 0 1-4 0H9a2 2 0 0 1-4 0zM3 12h18',
  inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5',
  quote: 'M5 3h10l4 4v14H5zM9 12h6M9 16h6M9 8h3',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5 21 21',
  star: 'M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.7l6.2-.9z',
  wrench:
    'M14.5 3.5a5 5 0 0 0-6 6.4L3 15.4 5.6 18l5.5-5.5a5 5 0 0 0 6.4-6l-3 3-2.4-.6-.6-2.4z',
};

// What a panel or a view says while it has nothing to show: a decorative
// icon, its sentences, and the one action projected into it, if any.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  selector: 'mf-empty-state',
  styleUrl: './empty-state.css',
  templateUrl: './empty-state.html',
})
export class EmptyState {
  readonly icon = input.required<EmptyIcon>();
  // A translation key.
  readonly text = input.required<string>();
  protected readonly paths = PATHS;
}
