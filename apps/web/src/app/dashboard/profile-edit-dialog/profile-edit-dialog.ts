import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  type AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  type ValidatorFn,
} from '@angular/forms';
import {
  type ClosedDay,
  DEFAULT_HOURS,
  type HoursSection,
  isWeeklyHours,
  type WeeklyHours,
} from '@motor-fix/contracts/garage-hours';
import {
  PROFILE_DESCRIPTION_MAX,
  PROFILE_RADIUS_KM,
} from '@motor-fix/contracts/garage-profile-limits';
import {
  isRomanianPhone,
  NAME_MAX,
  NAME_MIN,
  trimmedWithin,
} from '@motor-fix/contracts/listing-sections';
import { normalisePhone } from '@motor-fix/contracts/phone';
import { MOBILE_SERVICE_RADIUS_DEFAULT_KM } from '@motor-fix/contracts/place-section';
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
import { HlmButton, HlmInput, HlmLabel } from '@motor-fix/ui-cockpit';

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

// A rule of the shared contract, under the code the server names it by, so
// the field says the same whether the dialog or the server refused it.
const rule =
  (code: string, holds: (value: string) => boolean): ValidatorFn =>
  (control) =>
    holds(String(control.value ?? '')) ? null : { [code]: true };

// The shared normaliser's number, when it is a Romanian one.
const romanian = (value: string) => {
  const phone = normalisePhone(value);
  return phone !== null && isRomanianPhone(phone) ? phone : null;
};

// Blank asks for a number; anything the normaliser refuses is the listing's
// error, under the server's code for it.
const phoneRule: ValidatorFn = (control) => {
  const value = String(control.value ?? '');
  if (!value.trim()) return { phoneNeeded: true };
  return romanian(value) ? null : { phoneNumber: true };
};

// A whole number of km, digits only, within the shared range.
const radiusOf = (value: string): number | null => {
  const typed = value.trim();
  if (!/^\d{1,3}$/.test(typed)) return null;
  const km = Number(typed);
  return km >= PROFILE_RADIUS_KM.min && km <= PROFILE_RADIUS_KM.max ? km : null;
};

const GROUPS: Record<ProfileGroup, readonly string[]> = {
  area: ['serviceRadiusKm'],
  contact: ['phone'],
  hours: ['hours', 'closedDays'],
  texts: ['name', 'description'],
};

type FormValue = Partial<{
  closedDays: ClosedDay[];
  description: string;
  hours: WeeklyHours;
  name: string;
  phone: string;
  serviceRadiusKm: string;
}>;

// What the group sends: its own fields as the server takes them.
const bodyOf = ({
  description,
  name,
  phone,
  serviceRadiusKm,
  ...rest
}: FormValue) => ({
  ...rest,
  ...(name !== undefined && { name: name.trim() }),
  ...(description !== undefined && { description: description.trim() }),
  ...(phone !== undefined && { phone: romanian(phone) ?? phone }),
  ...(serviceRadiusKm !== undefined && {
    serviceRadiusKm: radiusOf(serviceRadiusKm) ?? Number(serviceRadiusKm),
  }),
});

const valuesOf = (profile: GarageProfileDto) => ({
  closedDays: closedDaysOf(profile),
  description: profile.description ?? '',
  hours: hoursOf(profile),
  name: profile.name,
  phone: profile.phone ?? '',
  serviceRadiusKm: String(
    profile.serviceRadiusKm ?? MOBILE_SERVICE_RADIUS_DEFAULT_KM,
  ),
});

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
    HlmInput,
    HlmLabel,
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
  private readonly i18n = inject(I18n);
  protected readonly group = this.task.data.group;
  protected readonly address =
    this.task.data.profile.businessKind === 'mobile'
      ? ''
      : (this.task.data.profile.address ?? '');
  private readonly garageId = this.task.data.garageId;
  private version = this.task.data.profile.version;

  private readonly start = valuesOf(this.task.data.profile);
  protected readonly form = new FormGroup({
    closedDays: new FormControl<ClosedDay[]>(this.start.closedDays, {
      nonNullable: true,
    }),
    description: new FormControl(this.start.description, {
      nonNullable: true,
      validators: rule('descriptionWithin', (value) =>
        trimmedWithin(value, 0, PROFILE_DESCRIPTION_MAX),
      ),
    }),
    hours: new FormControl<WeeklyHours>(this.start.hours, {
      nonNullable: true,
    }),
    name: new FormControl(this.start.name, {
      nonNullable: true,
      validators: rule('nameWithin', (value) =>
        trimmedWithin(value, NAME_MIN, NAME_MAX),
      ),
    }),
    phone: new FormControl(this.start.phone, {
      nonNullable: true,
      validators: phoneRule,
    }),
    serviceRadiusKm: new FormControl(this.start.serviceRadiusKm, {
      nonNullable: true,
      validators: rule('radius', (value) => radiusOf(value) !== null),
    }),
  });
  // The hours step's section: the week and the closed days, as the form holds.
  protected readonly section = signal<HoursSection>(this.sectionOf());

  protected readonly save = taskSave({
    done: (profile: GarageProfileDto) => this.task.close(profile),
    form: this.form,
    messages: 'garage.profile.edit',
    send: (value) =>
      this.api.garageProfileControllerUpdate({
        body: { ...bodyOf(value), version: this.version },
        garageId: this.garageId,
      }),
  });
  // Moves on every change, touch and status of the form, for the messages.
  private readonly changes = signal(0);

  // The 409 asks for a reload; once reloaded its line goes.
  private readonly reloaded = signal<Problem | null>(null);
  protected readonly stale = computed(() => {
    const problem = this.save.problem();
    return problem?.code === 'profile_changed' && problem !== this.reloaded();
  });
  protected readonly reloading = signal(false);

  constructor() {
    void this.i18n.enter('garage');
    for (const [name, control] of Object.entries(this.form.controls)) {
      if (!GROUPS[this.group].includes(name)) control.disable();
    }
    this.form.events
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.changes.update((n) => n + 1));
  }

  // A field's message: the server's once it answered, else the shared rule's
  // as soon as the owner leaves the field (or the press reveals it).
  protected errorOf(control: AbstractControl): string | null {
    this.changes();
    const errors = control.errors;
    if (!errors) return null;
    if ('server' in errors) return this.save.fieldError(control);
    if (!control.touched) return null;
    return this.i18n.t(`garage.profile.edit.field.${Object.keys(errors)[0]}`);
  }

  private sectionOf(): HoursSection {
    const { closedDays, hours } = this.form.getRawValue();
    return { closedDays, hours };
  }

  // The form as the profile reads, with every field untouched.
  private seed(profile: GarageProfileDto) {
    this.form.reset(valuesOf(profile));
    this.section.set(this.sectionOf());
  }

  // A number she typed reads back in the form it is stored in.
  protected normalisePhone() {
    const control = this.form.controls.phone;
    const phone = romanian(control.value);
    if (phone && phone !== control.value) control.setValue(phone);
  }

  protected keep(section: HoursSection) {
    this.form.patchValue({
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
      this.seed(profile);
      this.reloaded.set(this.save.problem());
    } catch {
      // The line stays, and the reload can be pressed again.
    } finally {
      this.reloading.set(false);
    }
  }
}
