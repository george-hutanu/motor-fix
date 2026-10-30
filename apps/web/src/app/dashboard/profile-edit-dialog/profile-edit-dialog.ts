import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  type ClosedDay,
  DEFAULT_HOURS,
  type HoursSection,
  isWeeklyHours,
  type WeeklyHours,
} from '@motor-fix/contracts/garage-hours';
import type { Problem } from '@motor-fix/contracts/problem';
import { type GarageProfileDto, GaragesService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  injectOverlayTask,
  type OverlayResult,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { HoursStep } from '../../public/hours-step/hours-step';

// The groups of the profile the owner edits, each in a dialog of its own.
export type ProfileGroup = 'texts' | 'hours' | 'contact' | 'area';

export interface ProfileEditData {
  group: ProfileGroup;
  garageId: string;
  // The profile as the view read it, with its change stamp.
  profile: GarageProfileDto;
}

const hoursOf = (profile: GarageProfileDto): WeeklyHours =>
  isWeeklyHours(profile.hours) ? profile.hours : DEFAULT_HOURS;
const closedDaysOf = (profile: GarageProfileDto): ClosedDay[] =>
  profile.storedClosedDays.map(({ day, note }) => ({
    day,
    ...(note && { note }),
  }));

// One group of the garage's profile, edited in place: the fields as read,
// saved with the profile's stamp, closed with the saved profile. A profile
// changed meanwhile is read again on request, into the dialog alone.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButton,
    HoursStep,
    ReactiveFormsModule,
    TaskError,
    TaskSubmit,
    TranslatePipe,
  ],
  selector: 'mf-profile-edit-dialog',
  styleUrl: './profile-edit-dialog.css',
  templateUrl: './profile-edit-dialog.html',
})
export class ProfileEditDialog {
  private readonly api = inject(GaragesService);
  protected readonly task = injectOverlayTask<
    ProfileEditData,
    OverlayResult<GarageProfileDto>
  >();
  protected readonly group = this.task.data.group;
  private readonly garageId = this.task.data.garageId;
  private version = this.task.data.profile.version;

  protected readonly form = new FormGroup({
    closedDays: new FormControl<ClosedDay[]>(
      closedDaysOf(this.task.data.profile),
      { nonNullable: true },
    ),
    hours: new FormControl<WeeklyHours>(hoursOf(this.task.data.profile), {
      nonNullable: true,
    }),
  });
  // The hours step's section: the week and the closed days, as the form holds.
  protected readonly section = signal<HoursSection>(this.sectionOf());

  protected readonly save = taskSave({
    done: (profile: GarageProfileDto) => this.task.close(profile),
    form: this.form,
    messages: 'garage.profile.edit',
    send: ({ closedDays = [], hours }) =>
      this.api.garageProfileControllerUpdate({
        body: { closedDays, hours, version: this.version },
        garageId: this.garageId,
      }),
  });

  // The 409 asks for a reload; once reloaded its line goes.
  private readonly reloaded = signal<Problem | null>(null);
  protected readonly stale = computed(() => {
    const problem = this.save.problem();
    return problem?.code === 'profile_changed' && problem !== this.reloaded();
  });
  protected readonly reloading = signal(false);

  constructor() {
    void inject(I18n).enter('garage');
  }

  private sectionOf(): HoursSection {
    const { closedDays, hours } = this.form.getRawValue();
    return { closedDays, hours };
  }

  protected keep(section: HoursSection) {
    this.form.setValue({
      closedDays: section.closedDays ?? [],
      hours: section.hours ?? DEFAULT_HOURS,
    });
    this.section.set(this.sectionOf());
  }

  // Reads the profile again into the dialog, and nothing else.
  protected async reload() {
    if (this.reloading()) return;
    this.reloading.set(true);
    try {
      const profile = await this.api.garageProfileControllerRead({
        garageId: this.garageId,
      });
      this.version = profile.version;
      this.form.setValue({
        closedDays: closedDaysOf(profile),
        hours: hoursOf(profile),
      });
      this.section.set(this.sectionOf());
      this.reloaded.set(this.save.problem());
    } catch {
      // The line stays, and the reload can be pressed again.
    } finally {
      this.reloading.set(false);
    }
  }
}
