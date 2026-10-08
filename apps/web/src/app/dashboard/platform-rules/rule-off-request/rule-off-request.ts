import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  AdminService,
  type PlatformRuleChangeDto,
} from '@motor-fix/data-access';
import { TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  injectOverlayTask,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

import { characters } from '../../../characters';

// The request to switch off a rule that needs a second admin: what changes,
// a reason, then "Trimite cererea". Closes with the request, or "cancelled".
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FieldError,
    HlmButton,
    HlmInput,
    ReactiveFormsModule,
    TaskError,
    TaskSubmit,
    TranslatePipe,
  ],
  selector: 'mf-rule-off-request',
  styleUrl: './rule-off-request.css',
  templateUrl: './rule-off-request.html',
})
export class RuleOffRequest {
  private readonly api = inject(AdminService);
  protected readonly task = injectOverlayTask<
    { key: string },
    PlatformRuleChangeDto | 'cancelled'
  >();

  protected readonly form = new FormGroup({
    reason: new FormControl('', {
      nonNullable: true,
      validators: [characters(5, 300, true)],
    }),
  });

  protected readonly save = taskSave({
    done: (sent: PlatformRuleChangeDto) => this.task.close(sent),
    form: this.form,
    messages: 'admin.platformRules.request',
    send: ({ reason = '' }) =>
      this.api.platformRuleChangesControllerRequest({
        body: { key: this.task.data.key, reason: reason.trim() },
      }),
  });
}
