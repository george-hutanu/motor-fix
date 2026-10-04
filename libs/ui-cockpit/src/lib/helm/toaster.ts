import { ChangeDetectionStrategy, Component } from '@angular/core';
import { BrnSonnerImports } from '@spartan-ng/brain/sonner';

export { toast } from '@spartan-ng/brain/sonner';

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
}
