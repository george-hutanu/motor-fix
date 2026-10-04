import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { BrnSonnerImports, type ToasterProps } from '@spartan-ng/brain/sonner';

export { toast } from '@spartan-ng/brain/sonner';

// Toasts take their colours from cockpit.css through the spartan-toast class;
// status is told by text, never by colour alone.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BrnSonnerImports],
  selector: 'hlm-toaster',
  template: `
    <brn-sonner-toaster
      [position]="position()"
      [duration]="duration()"
      [toastOptions]="toastOptions"
    />
  `,
})
export class HlmToaster {
  readonly position = input<ToasterProps['position']>('bottom-right');
  readonly duration = input<number>(4000);
  protected readonly toastOptions = { classes: { toast: 'spartan-toast' } };
}
