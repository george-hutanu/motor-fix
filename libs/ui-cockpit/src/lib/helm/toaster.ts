import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
} from '@angular/core';
import { BrnSonnerImports } from '@spartan-ng/brain/sonner';

export { toast } from '@spartan-ng/brain/sonner';

// The brain template puts its toast wrappers straight in the <ol> and gives
// each <li> role="status", which axe refuses (list, aria-allowed-role). The
// list keeps its items and each <li> stays a live region through its own
// aria-live and aria-atomic, which is all role="status" added.
function fixRoles(root: HTMLElement) {
  for (const list of root.querySelectorAll('ol[data-sonner-toaster]'))
    list.setAttribute('role', 'list');
  for (const wrapper of root.querySelectorAll('brn-sonner-toast'))
    wrapper.setAttribute('role', 'none');
  for (const item of root.querySelectorAll('li[data-sonner-toast][role]'))
    item.removeAttribute('role');
}

// Toasts take their colours from cockpit.css through the spartan-toast class;
// status is told by text, never by colour alone.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BrnSonnerImports],
  selector: 'hlm-toaster',
  template: `
    <brn-sonner-toaster [toastOptions]="toastOptions" />
  `,
})
export class HlmToaster {
  protected readonly toastOptions = { classes: { toast: 'spartan-toast' } };

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const watch = new MutationObserver(() => fixRoles(host));
      watch.observe(host, { childList: true, subtree: true });
      destroyRef.onDestroy(() => watch.disconnect());
    });
  }
}
