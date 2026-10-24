import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { type GarageMechanicDto, GaragesService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  injectOverlayTask,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton, toast } from '@motor-fix/ui-cockpit';

export type RemoveMechanicData = { card: GarageMechanicDto; garageId: string };

// "Elimini pe … din echipă?": the second, small dialog over the card. It
// names the card's confirmed bookings still ahead, which the garage then
// gives to someone else, and closes with true once the card is removed.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButton,
    ReactiveFormsModule,
    TaskError,
    TaskSubmit,
    TranslatePipe,
  ],
  selector: 'mf-remove-mechanic',
  styleUrl: './remove-mechanic.css',
  templateUrl: './remove-mechanic.html',
})
export class RemoveMechanic {
  private readonly garages = inject(GaragesService);
  private readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<
    RemoveMechanicData,
    true | 'cancelled'
  >();
  protected readonly card = this.task.data.card;
  protected readonly form = new FormGroup({});

  protected readonly save = taskSave({
    done: () => {
      toast(
        this.i18n.t('garage.mechanicCard.remove.done', {
          name: this.card.name,
        }),
      );
      this.task.close(true);
    },
    form: this.form,
    messages: 'garage.mechanicCard',
    send: async () => {
      try {
        return await this.garages.garageMechanicsControllerRemove({
          garageId: this.task.data.garageId,
          mechanicId: this.card.id,
        });
      } catch (error) {
        toast(this.i18n.t('garage.mechanicCard.remove.failed'));
        throw error;
      }
    },
  });

  constructor() {
    void this.i18n.enter('garage');
  }
}
