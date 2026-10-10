import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
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
} from '@angular/forms';
import { type MeDto, MeService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput, toast } from '@motor-fix/ui-cockpit';

import { characters } from '../../characters';
import { Session } from '../session';

const CONTROL = /\p{Cc}/u;

// No control characters, as the server refuses them.
const plain = (control: AbstractControl): ValidationErrors | null =>
  CONTROL.test(String(control.value ?? '')) ? { pattern: true } : null;

// The city may stay blank: no city is saved then.
const city = (control: AbstractControl): ValidationErrors | null =>
  String(control.value ?? '').trim() === ''
    ? null
    : characters(2, 60, true)(control);

// "Datele tale": the driver's name, phone, e-mail and city, the name and the
// city edited in place.
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
  selector: 'mf-my-details',
  styleUrl: './my-details.css',
  templateUrl: './my-details.html',
})
export class MyDetails {
  private readonly api = inject(MeService);
  private readonly i18n = inject(I18n);
  private readonly injector = inject(Injector);
  protected readonly session = inject(Session);

  protected readonly editing = signal(false);
  private readonly nameInput =
    viewChild<ElementRef<HTMLInputElement>>('nameInput');
  private readonly editButton =
    viewChild<ElementRef<HTMLButtonElement>>('editButton');

  protected readonly form = new FormGroup({
    city: new FormControl('', { nonNullable: true, validators: [city, plain] }),
    name: new FormControl('', {
      nonNullable: true,
      validators: [characters(2, 80, true), plain],
    }),
  });

  protected readonly save = taskSave({
    done: (me: MeDto) => {
      this.session.current.set(me);
      toast(this.i18n.t('driver.details.saved'));
      this.close();
    },
    form: this.form,
    messages: 'driver.details',
    send: () => {
      const { city, name } = this.form.getRawValue();
      return this.api.meControllerUpdate({
        body: { city: city.trim() || null, name: name.trim() },
      });
    },
  });

  constructor() {
    void this.i18n.enter('driver');
  }

  protected edit(me: MeDto) {
    this.form.reset({ city: me.city ?? '', name: me.name });
    this.editing.set(true);
    this.focus(() => this.nameInput());
  }

  protected close() {
    this.editing.set(false);
    this.focus(() => this.editButton());
  }

  private focus(target: () => ElementRef<HTMLElement> | undefined) {
    afterNextRender(() => target()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }
}
