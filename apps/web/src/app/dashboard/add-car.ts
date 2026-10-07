import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  type AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  type ValidationErrors,
  Validators,
} from '@angular/forms';
import { isRomanianPlate, normalisePlate } from '@motor-fix/contracts/plate';
import {
  type BrandDto,
  BrandsService,
  type CarDto,
  CarsService,
  type CreateCarDto,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  injectOverlayTask,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

import { characters } from '../sign-in/sign-up';

const SEARCH_PAUSE_MS = 250;
const MAX_KM = 2_000_000;
const FUELS = ['petrol', 'diesel', 'hybrid', 'electric'] as const;
const DATES = [
  { control: 'itpUntil', label: 'driver.cars.add.itp' },
  { control: 'rcaUntil', label: 'driver.cars.add.rca' },
  { control: 'rovinietaUntil', label: 'driver.cars.add.rovinieta' },
] as const;

const nextYear = () => new Date().getFullYear() + 1;

// Today in Bucharest five years on: the furthest a document date may be.
function latestDay() {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
  }).format(new Date());
  return `${Number(today.slice(0, 4)) + 5}${today.slice(4)}`;
}

// "148.200", "148 200" and "148,200" all mean 148200.
const kilometres = (text: string) => text.replace(/[\s.,]/g, '');

const year = (c: AbstractControl): ValidationErrors | null => {
  const value = Number(c.value);
  return /^\d{4}$/.test(c.value) && value >= 1950 && value <= nextYear()
    ? null
    : { year: true };
};

const km = (c: AbstractControl): ValidationErrors | null => {
  const digits = kilometres(c.value);
  return /^\d{1,7}$/.test(digits) && Number(digits) <= MAX_KM
    ? null
    : { server: 'km' };
};

const plate = (c: AbstractControl): ValidationErrors | null => {
  const stored = normalisePlate(c.value);
  return stored === '' || /^[A-Z0-9]{2,12}$/.test(stored)
    ? null
    : { pattern: true };
};

// The next option down or up the list, wrapping; from none, the first or last.
const step = (i: number, count: number, down: boolean) => {
  if (i < 0) return down ? 0 : count - 1;
  return (i + (down ? 1 : count - 1)) % count;
};

const chosen = (c: AbstractControl): ValidationErrors | null =>
  c.value ? null : { server: 'unknown_brand' };

// "Adaugă o mașină": the car's brand from the catalogue, its model, year,
// kilometres and fuel, then the optional plate, engine and document dates.
// Closes with the saved car.
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
  selector: 'mf-add-car',
  styles: `
    form { display: grid; gap: var(--mf-space-4); }
    .field { display: grid; gap: var(--mf-space-2); min-width: 0; }
    .field > label, legend, h3 { font-weight: 700; }
    fieldset { display: grid; gap: var(--mf-space-1); margin: 0; padding: 0; border: 0; min-width: 0; }
    legend { padding: 0; margin-bottom: var(--mf-space-2); }
    h3 { margin: var(--mf-space-2) 0 0; font-size: inherit; }
    p { margin: 0; overflow-wrap: anywhere; }
    .lead, .note { color: var(--mf-ink-muted); }
    .note { font-size: var(--mf-size-small); }
    .error { color: var(--mf-red-ink); font-size: var(--mf-size-small); }
    .fuels { display: flex; flex-wrap: wrap; gap: var(--mf-space-1) var(--mf-space-4); }
    .choice { display: flex; align-items: center; gap: var(--mf-space-2); min-height: var(--mf-tap); font-weight: 400; cursor: pointer; }
    .choice input { flex: none; width: 20px; height: 20px; margin: 0; accent-color: var(--mf-amber); }
    .choice input:focus-visible { outline: 2px solid var(--mf-amber-ink); outline-offset: 2px; }
    ul { list-style: none; margin: 0; padding: var(--mf-space-1) 0; border: 1px solid var(--mf-line-strong); border-radius: var(--mf-radius-sm, 8px); }
    li { display: flex; align-items: center; min-height: var(--mf-tap); padding: 0 var(--mf-space-3); cursor: pointer; overflow-wrap: anywhere; }
    li[aria-selected='true'], li:hover { background: var(--mf-line); }
    .actions { display: flex; flex-wrap: wrap; gap: var(--mf-space-3); }
    .actions button { white-space: normal; }
  `,
  template: `
    <form [formGroup]="form" (ngSubmit)="save.submit()" novalidate>
      <p class="lead">{{ 'driver.cars.add.lead' | t }}</p>
      <div class="field">
        <label for="mf-car-brand">{{ 'driver.cars.add.brand' | t }}</label>
        <input
          hlmInput
          id="mf-car-brand"
          type="text"
          role="combobox"
          autocomplete="off"
          aria-autocomplete="list"
          aria-controls="mf-car-brands"
          aria-describedby="mf-car-brand-error"
          [attr.aria-expanded]="brands().length > 0"
          [attr.aria-activedescendant]="active() < 0 ? null : 'mf-car-brand-' + active()"
          [class.ng-invalid]="form.controls.brandId.invalid"
          [value]="brandText()"
          (input)="find($any($event.target).value)"
          (keydown)="move($event)"
        />
        @if (brands().length) {
          <ul id="mf-car-brands" role="listbox" [attr.aria-label]="'driver.cars.add.brand' | t">
            @for (brand of brands(); track brand.id; let i = $index) {
              <li
                role="option"
                [id]="'mf-car-brand-' + i"
                [attr.aria-selected]="i === active()"
                (mousedown)="$event.preventDefault()"
                (click)="choose(brand)"
              >{{ brand.name }}</li>
            }
          </ul>
        } @else if (brandsDown()) {
          <p class="error" role="alert">{{ 'driver.cars.add.brandsDown' | t }}</p>
          <div class="actions">
            <button hlmBtn variant="secondary" type="button" (click)="search()">{{ 'driver.cars.add.retry' | t }}</button>
          </div>
        } @else if (noMatch()) {
          <p class="note" role="status">{{ 'driver.cars.add.noMatch' | t }}</p>
        }
        <mf-field-error id="mf-car-brand-error" [save]="save" [control]="form.controls.brandId" />
      </div>
      <div class="field">
        <label for="mf-car-model">{{ 'driver.cars.add.model' | t }}</label>
        <input hlmInput id="mf-car-model" type="text" autocomplete="off" formControlName="model" aria-describedby="mf-car-model-error" />
        <mf-field-error id="mf-car-model-error" [save]="save" [control]="form.controls.model" />
      </div>
      <div class="field">
        <label for="mf-car-year">{{ 'driver.cars.add.year' | t }}</label>
        <input hlmInput id="mf-car-year" type="text" inputmode="numeric" autocomplete="off" formControlName="year" aria-describedby="mf-car-year-error" />
        <p class="error" id="mf-car-year-error">{{ yearError() }}</p>
      </div>
      <div class="field">
        <label for="mf-car-km">{{ 'driver.cars.add.km' | t }}</label>
        <input hlmInput id="mf-car-km" type="text" inputmode="numeric" autocomplete="off" formControlName="odometerKm" aria-describedby="mf-car-km-error" />
        <mf-field-error id="mf-car-km-error" [save]="save" [control]="form.controls.odometerKm" />
      </div>
      <fieldset aria-describedby="mf-car-fuel-error">
        <legend>{{ 'driver.cars.add.fuel.label' | t }}</legend>
        <div class="fuels">
          @for (fuel of fuels; track fuel) {
            <label class="choice"><input type="radio" formControlName="fuel" [value]="fuel" />{{ fuelKey(fuel) | t }}</label>
          }
        </div>
        <mf-field-error id="mf-car-fuel-error" [save]="save" [control]="form.controls.fuel" />
      </fieldset>
      <h3>{{ 'driver.cars.add.optional' | t }}</h3>
      <div class="field">
        <label for="mf-car-plate">{{ 'driver.cars.add.plate' | t }}</label>
        <input hlmInput id="mf-car-plate" type="text" autocomplete="off" spellcheck="false" formControlName="plate" aria-describedby="mf-car-plate-error mf-car-plate-note" />
        <mf-field-error id="mf-car-plate-error" [save]="save" [control]="form.controls.plate" />
        <p class="note" id="mf-car-plate-note" aria-live="polite">@if (plateNote(); as note) { {{ note | t }} }</p>
      </div>
      <div class="field">
        <label for="mf-car-engine">{{ 'driver.cars.add.engine' | t }}</label>
        <input hlmInput id="mf-car-engine" type="text" autocomplete="off" formControlName="engine" aria-describedby="mf-car-engine-error" />
        <mf-field-error id="mf-car-engine-error" [save]="save" [control]="form.controls.engine" />
      </div>
      @for (date of dates; track date.control) {
        <div class="field">
          <label [for]="'mf-car-' + date.control">{{ date.label | t }}</label>
          <input
            hlmInput
            type="date"
            [id]="'mf-car-' + date.control"
            [max]="latest"
            [formControlName]="date.control"
            [attr.aria-describedby]="'mf-car-' + date.control + '-error'"
          />
          <mf-field-error [id]="'mf-car-' + date.control + '-error'" [save]="save" [control]="form.controls[date.control]" />
        </div>
      }
      <mf-task-error [save]="save" />
      <div class="actions">
        <button hlmBtn type="submit" [mfTaskSubmit]="save">{{ 'driver.cars.add.submit' | t }}</button>
      </div>
    </form>
  `,
})
export class AddCar {
  private readonly catalogue = inject(BrandsService);
  private readonly cars = inject(CarsService);
  private readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<{ plates: string[] }, CarDto>();

  protected readonly fuels = FUELS;
  protected readonly dates = DATES;
  protected readonly latest = latestDay();

  private readonly notAfterLatest = (
    c: AbstractControl,
  ): ValidationErrors | null =>
    c.value && c.value > this.latest ? { server: 'too_far_ahead' } : null;

  protected readonly form = new FormGroup({
    brandId: new FormControl('', { nonNullable: true, validators: chosen }),
    engine: new FormControl('', {
      nonNullable: true,
      validators: Validators.maxLength(30),
    }),
    fuel: new FormControl<(typeof FUELS)[number] | null>(null, {
      validators: Validators.required,
    }),
    itpUntil: new FormControl('', {
      nonNullable: true,
      validators: this.notAfterLatest,
    }),
    model: new FormControl('', {
      nonNullable: true,
      validators: characters(1, 40, true),
    }),
    odometerKm: new FormControl('', { nonNullable: true, validators: km }),
    plate: new FormControl('', { nonNullable: true, validators: plate }),
    rcaUntil: new FormControl('', {
      nonNullable: true,
      validators: this.notAfterLatest,
    }),
    rovinietaUntil: new FormControl('', {
      nonNullable: true,
      validators: this.notAfterLatest,
    }),
    year: new FormControl('', { nonNullable: true, validators: year }),
  });

  protected readonly save = taskSave({
    done: (car: CarDto) => this.task.close(car),
    form: this.form,
    messages: 'driver.cars.add',
    send: (_, key) =>
      this.cars.carsControllerCreate({
        body: this.body(),
        'Idempotency-Key': key,
      }),
  });

  protected readonly brandText = signal('');
  protected readonly brands = signal<BrandDto[]>([]);
  protected readonly active = signal(-1);
  protected readonly brandsDown = signal(false);
  protected readonly noMatch = signal(false);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private searches = 0;

  private readonly plateValue = toSignal(
    this.form.controls.plate.valueChanges,
    {
      initialValue: '',
    },
  );
  protected readonly plateNote = computed(() => {
    const stored = normalisePlate(this.plateValue());
    if (stored === '') return null;
    if (this.task.data.plates.includes(stored))
      return 'driver.cars.add.plateHeld';
    return isRomanianPlate(stored) ? null : 'driver.cars.add.plateCheck';
  });

  constructor() {
    void this.i18n.enter('driver');
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  protected fuelKey(fuel: (typeof FUELS)[number]) {
    return `driver.cars.add.fuel.${fuel}`;
  }

  protected yearError() {
    return this.save.fieldError(this.form.controls.year) === null
      ? ''
      : this.i18n.t('driver.cars.add.yearRange', { max: nextYear() });
  }

  protected find(typed: string) {
    this.brandText.set(typed);
    this.form.controls.brandId.setValue('');
    clearTimeout(this.timer);
    this.close();
    if (typed.trim() === '') return;
    this.timer = setTimeout(() => void this.search(), SEARCH_PAUSE_MS);
  }

  protected async search() {
    const turn = ++this.searches;
    this.brandsDown.set(false);
    try {
      const page = await this.catalogue.brandsControllerSearch({
        q: this.brandText().trim(),
      });
      if (turn !== this.searches) return;
      this.brands.set(page.items);
      this.noMatch.set(page.items.length === 0);
    } catch {
      if (turn === this.searches) this.brandsDown.set(true);
    }
  }

  protected choose(brand: BrandDto) {
    this.brandText.set(brand.name);
    this.form.controls.brandId.setValue(brand.id);
    this.close();
  }

  // Arrows walk the list, Enter takes the brand, Escape closes the list
  // and not the dialog.
  protected move(event: KeyboardEvent) {
    const count = this.brands().length;
    if (count === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.active.update((i) => step(i, count, event.key === 'ArrowDown'));
    } else if (event.key === 'Enter' && this.active() >= 0) {
      event.preventDefault();
      this.choose(this.brands()[this.active()]);
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      this.close();
    }
  }

  private close() {
    this.searches++;
    this.brands.set([]);
    this.active.set(-1);
    this.brandsDown.set(false);
    this.noMatch.set(false);
  }

  private body(): CreateCarDto {
    const value = this.form.getRawValue();
    const optional = {
      engine: value.engine.trim(),
      itpUntil: value.itpUntil,
      plate: normalisePlate(value.plate),
      rcaUntil: value.rcaUntil,
      rovinietaUntil: value.rovinietaUntil,
    };
    return {
      brandId: value.brandId,
      fuel: value.fuel as CreateCarDto['fuel'],
      model: value.model.trim(),
      odometerKm: Number(kilometres(value.odometerKm)),
      year: Number(value.year),
      ...Object.fromEntries(
        Object.entries(optional).filter(([, given]) => given !== ''),
      ),
    };
  }
}
