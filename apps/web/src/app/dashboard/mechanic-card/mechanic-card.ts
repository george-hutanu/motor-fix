import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  Injector,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  type AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  type ValidationErrors,
  type ValidatorFn,
} from '@angular/forms';
import {
  CERTIFICATION_MAX,
  CERTIFICATIONS_MAX,
  MECHANIC_CARD_NAME_MAX,
  MECHANIC_NAME_MIN,
  ROLE_TITLE_MAX,
  SPECIALTIES_MAX,
  TAG_MAX,
  YEARS_MAX,
} from '@motor-fix/contracts/listing-sections';
import {
  type GarageBrandOptionDto,
  type GarageMechanicDto,
  GaragesService,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  injectOverlayTask,
  Overlays,
  TaskError,
  TaskSubmit,
  taskSave,
  toProblem,
} from '@motor-fix/overlays';
import {
  HlmButton,
  HlmInput,
  HlmTabsImports,
  toast,
} from '@motor-fix/ui-cockpit';

import {
  InviteStaff,
  type InviteStaffData,
} from '../invite-staff/invite-staff';
import { MechanicSchedule } from '../mechanic-schedule/mechanic-schedule';
import {
  RemoveMechanic,
  type RemoveMechanicData,
} from '../remove-mechanic/remove-mechanic';

type CardInvite = NonNullable<GarageMechanicDto['invite']>;

export type MechanicCardData = {
  brands: GarageBrandOptionDto[];
  card?: GarageMechanicDto;
  garageId: string;
  // The card as the list now reads it, once its invite changed.
  refresh?: () => Promise<GarageMechanicDto | undefined>;
};

// The fields by name, for the template: a quoted name there would read as
// text shown to the person.
const FIELDS = {
  brandIds: 'brandIds',
  certifications: 'certifications',
  name: 'name',
  roleTitle: 'roleTitle',
  specialties: 'specialties',
  years: 'years',
} as const;
type Field = keyof typeof FIELDS;

// A comma-separated field as the tags it stores: each trimmed, the empty
// ones dropped.
const tagsOf = (text: string) =>
  text
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');

// Counted in code points, as the server counts them.
const lengthOf = (text: string) => [...text].length;

// Each rule answers with the key of its own message under
// `garage.mechanicCard.field`.
const nameRule: ValidatorFn = (control) => {
  const length = lengthOf(String(control.value ?? '').trim());
  if (length < MECHANIC_NAME_MIN) return { nameRequired: true };
  return length > MECHANIC_CARD_NAME_MAX ? { nameLong: true } : null;
};

const roleRule: ValidatorFn = (control) =>
  lengthOf(String(control.value ?? '').trim()) > ROLE_TITLE_MAX
    ? { roleLong: true }
    : null;

const tagRule =
  (most: number, longest: number, many: string, long: string): ValidatorFn =>
  (control) => {
    const tags = tagsOf(String(control.value ?? ''));
    if (tags.length > most) return { [many]: true };
    return tags.some((tag) => lengthOf(tag) > longest)
      ? { [long]: true }
      : null;
  };

const yearsRule: ValidatorFn = (control) => {
  const value = control.value;
  if (value === null || value === '') return null;
  const years = Number(value);
  return Number.isInteger(years) && years >= 0 && years <= YEARS_MAX
    ? null
    : { years: true };
};

// The server's code for a field, as the field's own message.
const SERVER: Record<Field, (code: string) => string> = {
  brandIds: () => 'brands',
  certifications: (code) =>
    code === 'too_many' ? 'certificationsMany' : 'certificationLong',
  name: (code) => (code === 'too_long' ? 'nameLong' : 'nameRequired'),
  roleTitle: () => 'roleLong',
  specialties: (code) =>
    code === 'too_many' ? 'specialtiesMany' : 'specialtyLong',
  years: () => 'years',
};

// The card dialog: the owner adds a mechanic, or edits a card, the owner's
// own row included. Photo, bio and languages are the mechanic's, shown as
// such and never sent. "Elimină" asks first, on any card but the owner's.
// A saved card with no account offers "Invită", or shows its open invite
// with "Retrimite" and "Anulează invitația".
// Closes with "saved", or "removed" once the card is gone (removed here, or
// found removed in another tab).
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButton,
    HlmInput,
    HlmTabsImports,
    MechanicSchedule,
    NgTemplateOutlet,
    ReactiveFormsModule,
    TaskError,
    TaskSubmit,
    TranslatePipe,
  ],
  selector: 'mf-mechanic-card',
  styleUrl: './mechanic-card.css',
  templateUrl: './mechanic-card.html',
})
export class MechanicCard {
  private readonly garages = inject(GaragesService);
  private readonly i18n = inject(I18n);
  private readonly injector = inject(Injector);
  private readonly overlays = inject(Overlays);
  protected readonly task = injectOverlayTask<
    MechanicCardData,
    'saved' | 'removed' | 'cancelled'
  >();
  protected readonly field = FIELDS;
  protected readonly card = this.task.data.card;
  protected readonly brands = this.task.data.brands;
  protected readonly current = signal(this.card);
  protected readonly invitable = computed(() => {
    const card = this.current();
    return !!card && !card.hasAccount && !card.isOwner;
  });
  // The invite action in flight: its button shows progress, both are inert.
  protected readonly inviting = signal<'resend' | 'revoke' | null>(null);
  private readonly inviteBlock =
    viewChild<ElementRef<HTMLElement>>('inviteBlock');
  private readonly inviteButton =
    viewChild<ElementRef<HTMLButtonElement>>('inviteButton');
  protected readonly garageId = this.task.data.garageId;
  // The schedule is read only once its tab is opened: a card edit alone
  // never waits on it.
  protected readonly scheduleOpened = signal(false);

  protected readonly form = new FormGroup({
    brandIds: new FormGroup(
      Object.fromEntries(
        this.brands.map((brand) => [
          brand.id,
          new FormControl(this.card?.brandIds.includes(brand.id) ?? false, {
            nonNullable: true,
          }),
        ]),
      ),
    ),
    certifications: new FormControl(
      this.card?.certifications.join(', ') ?? '',
      {
        nonNullable: true,
        validators: [
          tagRule(
            CERTIFICATIONS_MAX,
            CERTIFICATION_MAX,
            'certificationsMany',
            'certificationLong',
          ),
        ],
      },
    ),
    name: new FormControl(this.card?.name ?? '', {
      nonNullable: true,
      validators: [nameRule],
    }),
    roleTitle: new FormControl(this.card?.roleTitle ?? '', {
      nonNullable: true,
      validators: [roleRule],
    }),
    specialties: new FormControl(this.card?.specialties.join(', ') ?? '', {
      nonNullable: true,
      validators: [
        tagRule(SPECIALTIES_MAX, TAG_MAX, 'specialtiesMany', 'specialtyLong'),
      ],
    }),
    years: new FormControl<number | null>(this.card?.years ?? null, {
      validators: [yearsRule],
    }),
  });

  protected readonly save = taskSave({
    done: () => {
      toast(this.i18n.t('garage.mechanicCard.saved'));
      this.task.close('saved');
    },
    form: this.form,
    messages: 'garage.mechanicCard',
    send: async () => {
      const body = this.body();
      // Every field waits, unchangeable, while the card is on its way.
      this.form.disable();
      try {
        return this.card
          ? await this.garages.garageMechanicsControllerEdit({
              body,
              garageId: this.task.data.garageId,
              mechanicId: this.card.id,
            })
          : await this.garages.garageMechanicsControllerAdd({
              body,
              garageId: this.task.data.garageId,
            });
      } catch (error) {
        this.form.enable();
        this.refused(error);
        throw error;
      }
    },
  });

  constructor() {
    void this.i18n.enter('garage');
  }

  private body() {
    const value = this.form.getRawValue();
    return {
      brandIds: this.brands
        .filter((brand) => value.brandIds[brand.id])
        .map((brand) => brand.id),
      certifications: tagsOf(value.certifications),
      name: value.name.trim(),
      roleTitle: value.roleTitle.trim() || null,
      specialties: tagsOf(value.specialties),
      years: value.years === null ? null : Number(value.years),
    };
  }

  // A card removed in another tab is gone: the list reads again.
  private refused(error: unknown) {
    if (this.card && toProblem(error).code === 'not_found') {
      toast(this.i18n.t('garage.mechanicCard.gone'));
      this.task.close('removed');
      return;
    }
    toast(this.i18n.t('garage.mechanicCard.failed'));
  }

  // The message under a field once the press or the server revealed it.
  protected problem(field: Field): string {
    const control: AbstractControl = this.form.controls[field];
    const errors: ValidationErrors | null = control.errors;
    if (!errors || this.save.fieldError(control) === null) return '';
    const server = errors['server'];
    const key =
      typeof server === 'string'
        ? SERVER[field](server)
        : (Object.keys(errors)[0] ?? '');
    return this.i18n.t(`garage.mechanicCard.field.${key}`);
  }

  protected tags(field: 'certifications' | 'specialties') {
    return tagsOf(this.form.controls[field].value);
  }

  protected inviteLine(invite: CardInvite) {
    const to = invite.email ?? invite.phone ?? '';
    if (Date.parse(invite.expiresAt) <= Date.now()) {
      return this.i18n.t('garage.mechanicCard.invite.expired', { to });
    }
    const date = new Intl.DateTimeFormat(
      this.i18n.language() === 'ro' ? 'ro-RO' : 'en-GB',
      {
        day: '2-digit',
        month: '2-digit',
        timeZone: 'Europe/Bucharest',
        year: 'numeric',
      },
    ).format(new Date(invite.expiresAt));
    return this.i18n.t('garage.mechanicCard.invite.sent', { date, to });
  }

  protected async openInvite() {
    const card = this.current();
    if (!card) return;
    const sent = await this.overlays.open<'sent', InviteStaffData>(
      InviteStaff,
      {
        data: {
          card: { id: card.id, name: card.name },
          garageId: this.task.data.garageId,
        },
        shape: 'dialog',
        title: 'garage.invite.titleCard',
        titleParams: { name: card.name },
      },
    );
    if (sent === 'sent') await this.refresh();
  }

  protected resend(id: string) {
    return this.answer('resend', () =>
      this.garages.garageInvitesControllerResend({
        garageId: this.task.data.garageId,
        id,
      }),
    );
  }

  protected revoke(id: string) {
    return this.answer('revoke', () =>
      this.garages.garageInvitesControllerRevoke({
        garageId: this.task.data.garageId,
        id,
      }),
    );
  }

  // One invite action at a time; whatever it answers, the card reads again,
  // since a refusal means the invite changed elsewhere. The focus then goes
  // to the invite block's first button, enabled again: "Retrimite" while an
  // invite is open, else "Invită" beside "Salvează" once it is gone.
  private async answer(
    action: 'resend' | 'revoke',
    act: () => Promise<unknown>,
  ) {
    if (this.inviting()) return;
    this.inviting.set(action);
    try {
      await act();
    } catch (error) {
      toast(
        this.i18n.t(
          toProblem(error).code === 'invite_invalid'
            ? 'garage.mechanicCard.invite.gone'
            : 'garage.mechanicCard.invite.failed',
        ),
      );
    } finally {
      await this.refresh();
      this.inviting.set(null);
      afterNextRender(
        () =>
          (
            this.inviteBlock()?.nativeElement.querySelector('button') ??
            this.inviteButton()?.nativeElement
          )?.focus(),
        { injector: this.injector },
      );
    }
  }

  private async refresh() {
    const fresh = await this.task.data.refresh?.();
    if (fresh) this.current.set(fresh);
  }

  protected async remove() {
    if (!this.card) return;
    const removed = await this.overlays.open<true, RemoveMechanicData>(
      RemoveMechanic,
      {
        data: { card: this.card, garageId: this.task.data.garageId },
        shape: 'dialog',
        title: 'garage.mechanicCard.remove.title',
      },
    );
    if (removed === true) this.task.close('removed');
  }
}
