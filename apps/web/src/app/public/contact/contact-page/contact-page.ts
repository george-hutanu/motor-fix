import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslatePipe } from '@motor-fix/i18n';

import { supportAddress } from '../contact';
import { ContactForm } from '../contact-form/contact-form';

// "Contact": who answers, the support address when there is one, and the form.
// Rendered on the server, open to anyone.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ContactForm, TranslatePipe],
  selector: 'mf-contact-page',
  styleUrl: './contact-page.css',
  templateUrl: './contact-page.html',
})
export class ContactPage {
  protected readonly address = supportAddress();
}
