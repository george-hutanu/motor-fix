import { Component, input } from '@angular/core';

// Reviews, notes, captions and names: shown as their author wrote them, in
// any language, and kept away from the browser's page translation too.
@Component({
  host: { translate: 'no' },
  selector: 'mf-as-written',
  template: '{{ text() }}',
})
export class AsWritten {
  readonly text = input.required<string>();
}
