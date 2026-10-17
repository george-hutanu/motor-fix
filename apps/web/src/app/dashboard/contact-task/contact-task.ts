import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { injectOverlayTask } from '@motor-fix/overlays';

import { ContactForm } from '../../public/contact/contact-form/contact-form';
import { Session } from '../session';

// "Ajutor și contact" from a dashboard's menu: the contact page's form in the
// drawer, name and e-mail filled from the account. The role is the session's,
// read by the API, never a field.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ContactForm],
  selector: 'mf-contact-task',
  templateUrl: './contact-task.html',
})
export class ContactTask {
  private readonly task = injectOverlayTask<undefined, true>();
  private readonly session = inject(Session);

  protected readonly prefill = computed(() => {
    const me = this.session.current();
    return me ? { email: me.email, name: me.name } : null;
  });

  protected close() {
    this.task.close(true);
  }
}
