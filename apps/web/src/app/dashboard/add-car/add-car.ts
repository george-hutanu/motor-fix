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
import {
  FUELS,
  isRomanianPlate,
  MAX_KM,
  normalisePlate,
  STORED_PLATE,
} from '@motor-fix/contracts/plate';
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

import { characters } from '../../sign-in/sign-up/sign-up';

const SEARCH_PAUSE_MS = 250;
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
  return stored === '' || STORED_PLATE.test(stored) ? null : { pattern: true };
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
  styleUrl: './add-car.css',
  templateUrl: './add-car.html',
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
