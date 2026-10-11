import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
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
import { Router } from '@angular/router';
import type { GarageCannotReceiveProblem } from '@motor-fix/contracts';
import {
  CANNOT_RECEIVE_REASONS,
  type CannotReceiveReason,
  REQUEST_DESCRIPTION_MAX,
  REQUEST_DESCRIPTION_MIN_WITHOUT_JOBS,
  REQUEST_MAX_GARAGES,
} from '@motor-fix/contracts/request-status';
import { nearOf } from '@motor-fix/contracts/search-place';
import {
  type CandidateGarageDto,
  type CarDto,
  CarsService,
  type CreateQuoteRequestDto,
  type PublicGarageDto,
  type PublicJobTypeDto,
  QuoteRequestsService,
  type RequestDto,
} from '@motor-fix/data-access';
import { I18n, KmPipe, TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  injectOverlayTask,
  Overlays,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput, HlmSwitch } from '@motor-fix/ui-cockpit';

import { answersLine, sentLine } from './sent-line';
import { type Place, PlaceStore } from '../../../home/place/place-store';

export interface RequestQuoteData {
  garage: PublicGarageDto;
  // Where the profile was opened from; every garage ticked here is `search`.
  source: 'profile_direct' | 'shared_link';
  // Told the request as soon as it is sent, whether or not the dialog is
  // then closed by its X.
  sent?: (request: RequestDto) => void;
}

// What the dialog closes with: the request it sent, nothing, or where one of
// its links points, for the opener to go once the dialog has closed.
export type RequestQuoteResult = RequestDto | 'cancelled' | { go: string };

type Nearby = 'idle' | 'loading' | 'ready' | 'failed' | 'no-place';

// The fuel as a word inside a sentence: "motorină", "diesel".
const FUEL_WORDS: Record<CarDto['fuel'], string> = {
  diesel: 'public.requestQuote.fuelWord.diesel',
  electric: 'public.requestQuote.fuelWord.electric',
  hybrid: 'public.requestQuote.fuelWord.hybrid',
  petrol: 'public.requestQuote.fuelWord.petrol',
};

// The line that names why a garage cannot take the request.
const CANNOT_RECEIVE: Record<CannotReceiveReason, string> = {
  brand: 'public.requestQuote.cannotReceive.brand',
  fuel: 'public.requestQuote.cannotReceive.fuel',
  jobs: 'public.requestQuote.cannotReceive.jobs',
  not_taking_requests: 'public.requestQuote.cannotReceive.not_taking_requests',
};

// A reason this build does not know reads as the garage not taking requests.
const knownReason = (reason: unknown): CannotReceiveReason =>
  (CANNOT_RECEIVE_REASONS as readonly unknown[]).includes(reason)
    ? (reason as CannotReceiveReason)
    : 'not_taking_requests';

interface Unreceivable {
  garageId: string;
  name: string;
  reason: CannotReceiveReason;
}

// "Cere ofertă": the car, the garage's jobs, what is wrong, and up to four
// more garages near the place; sends one request to them all.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:offline)': 'online.set(false)',
    '(window:online)': 'online.set(true)',
  },
  imports: [
    FieldError,
    HlmButton,
    HlmInput,
    HlmSwitch,
    KmPipe,
    ReactiveFormsModule,
    TaskError,
    TaskSubmit,
    TranslatePipe,
  ],
  selector: 'mf-request-quote',
  styleUrl: './request-quote.css',
  templateUrl: './request-quote.html',
})
export class RequestQuote {
  private readonly carsApi = inject(CarsService);
  private readonly api = inject(QuoteRequestsService);
  private readonly overlays = inject(Overlays);
  private readonly places = inject(PlaceStore);
  protected readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<
    RequestQuoteData,
    RequestQuoteResult
  >();
  private readonly router = inject(Router);
  protected readonly garage = this.task.data.garage;

  protected readonly max = REQUEST_DESCRIPTION_MAX;
  protected readonly online = signal(globalThis.navigator?.onLine !== false);
  protected readonly cars = signal<CarDto[] | undefined>(undefined);
  protected readonly carsFailed = signal(false);
  protected readonly nearby = signal<CandidateGarageDto[]>([]);
  protected readonly nearbyState = signal<Nearby>('idle');
  protected readonly limitHit = signal(false);
  protected readonly unreceivable = signal<Unreceivable | null>(null);
  private reads = 0;

  // With no job switched on, the description says what is wrong.
  private readonly enough = (c: AbstractControl): ValidationErrors | null => {
    if (this.form?.controls.jobTypeIds.value.length) return null;
    const typed = String(c.value ?? '').trim();
    if (typed === '') return { server: 'description_needed' };
    return typed.length < REQUEST_DESCRIPTION_MIN_WITHOUT_JOBS
      ? { server: 'too_short' }
      : null;
  };

  protected readonly form = new FormGroup({
    carId: new FormControl('', {
      nonNullable: true,
      validators: Validators.required,
    }),
    description: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(REQUEST_DESCRIPTION_MAX), this.enough],
    }),
    garageIds: new FormControl<string[]>([], { nonNullable: true }),
    jobTypeIds: new FormControl<string[]>([], { nonNullable: true }),
  });

  protected readonly save = taskSave({
    done: (request: RequestDto) => this.task.data.sent?.(request),
    form: this.form,
    messages: 'public.requestQuote',
    send: (_, key) =>
      this.api
        .quoteRequestsControllerSend({
          body: this.body(),
          'Idempotency-Key': key,
        })
        .catch((failure: unknown) => {
          this.refused(failure);
          throw failure;
        }),
  });

  private readonly carId = toSignal(this.form.controls.carId.valueChanges, {
    initialValue: '',
  });
  private readonly jobs = toSignal(this.form.controls.jobTypeIds.valueChanges, {
    initialValue: [] as string[],
  });
  private readonly ticked = toSignal(
    this.form.controls.garageIds.valueChanges,
    { initialValue: [] as string[] },
  );
  private readonly typed = toSignal(
    this.form.controls.description.valueChanges,
    {
      initialValue: '',
    },
  );
  protected readonly length = computed(() => this.typed().length);

  private readonly chosenCar = computed(
    () => this.cars()?.find((car) => car.id === this.carId()) ?? null,
  );

  // The profile garage's own red lamp for the chosen car, before any send.
  protected readonly carRefused = computed(() => {
    const car = this.chosenCar();
    if (!car) return null;
    const brand = this.garage.worksOn.find((b) => b.id === car.brandId);
    if (!brand)
      return this.i18n.t('public.requestQuote.carRefused.brand', {
        brand: car.brandName,
      });
    if (brand.fuels.includes(car.fuel)) return null;
    return this.i18n.t('public.requestQuote.carRefused.fuel', {
      brand: car.brandName,
      fuel: this.i18n.t(FUEL_WORDS[car.fuel]),
    });
  });

  // A garage the server refused, named with the car's brand and fuel.
  protected readonly refusedLine = computed(() => {
    const refused = this.unreceivable();
    if (!refused) return '';
    const car = this.chosenCar();
    return this.i18n.t(CANNOT_RECEIVE[refused.reason], {
      brand: car?.brandName ?? '',
      fuel: car ? this.i18n.t(FUEL_WORDS[car.fuel]) : '',
      garage: refused.name,
    });
  });

  constructor() {
    this.form.controls.description.updateValueAndValidity();
    void this.loadCars();
    effect(() => {
      const carId = this.carId();
      const jobs = this.jobs();
      const place = this.places.place();
      untracked(() => void this.readNearby(carId, jobs, place));
    });
  }

  protected carLabel(car: CarDto) {
    return `${car.brandName} ${car.model} ${car.year}`;
  }

  protected jobName(job: PublicJobTypeDto) {
    return this.i18n.language() === 'ro' ? job.nameRo : job.nameEn;
  }

  protected jobOn(id: string) {
    return this.jobs().includes(id);
  }

  protected toggleJob(id: string, on: boolean) {
    const jobs = this.form.controls.jobTypeIds.value.filter((j) => j !== id);
    this.form.controls.jobTypeIds.setValue(on ? [...jobs, id] : jobs);
    this.form.controls.description.updateValueAndValidity();
  }

  protected isTicked(id: string) {
    return this.ticked().includes(id);
  }

  // The profile's garage counts toward the five.
  protected tick(id: string, event: Event) {
    const box = event.target as HTMLInputElement;
    const ticked = this.form.controls.garageIds.value.filter((g) => g !== id);
    if (box.checked && ticked.length + 1 >= REQUEST_MAX_GARAGES) {
      box.checked = false;
      this.limitHit.set(true);
      return;
    }
    this.limitHit.set(false);
    this.form.controls.garageIds.setValue(
      box.checked ? [...ticked, id] : ticked,
    );
  }

  protected async loadCars() {
    this.carsFailed.set(false);
    try {
      const { items } = await this.carsApi.carsControllerList();
      this.cars.set(items);
      if (items.length === 1) this.form.controls.carId.setValue(items[0].id);
    } catch {
      this.carsFailed.set(true);
    }
  }

  protected async pickPlace() {
    const { PlaceDialog } = await import(
      '../../../home/place/place-dialog/place-dialog'
    );
    const place = await this.overlays.open<Place>(PlaceDialog, {
      confirmDiscard: false,
      shape: 'dialog',
      title: 'public.home.place.title',
    });
    if (place !== 'cancelled') this.places.set(place);
  }

  protected retryNearby() {
    void this.readNearby(this.carId(), this.jobs(), this.places.place());
  }

  protected backToSearch() {
    const brand = this.garage.brand;
    const home = ['/', this.i18n.language()];
    const tree = this.router.createUrlTree(
      brand ? [...home, 'garages'] : home,
      { queryParams: brand ? { brand: brand.slug } : {} },
    );
    return this.router.serializeUrl(tree);
  }

  // A link out closes the dialog and leaves the navigation to the opener:
  // closing steps back over the dialog's history entry, which would undo a
  // navigation the link had already started. A modified click opens the
  // address the browser's way.
  protected leave(event: MouseEvent, go: string) {
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    this.task.close({ go });
  }

  protected sentLine(request: RequestDto) {
    return sentLine(this.i18n, request);
  }

  protected answersLine(request: RequestDto) {
    const [only, ...more] = request.recipients;
    return only && more.length === 0 ? answersLine(this.i18n, only) : null;
  }

  protected names(request: RequestDto) {
    return request.recipients.map(
      (r) => answersLine(this.i18n, r) ?? r.garage.name,
    );
  }

  private async readNearby(carId: string, jobs: string[], place: Place | null) {
    const turn = ++this.reads;
    if (!carId) {
      this.nearbyState.set('idle');
      return;
    }
    if (!place) {
      this.nearbyState.set('no-place');
      return;
    }
    this.nearbyState.set('loading');
    try {
      const { items } = await this.api.quoteRequestsControllerCandidates({
        carId,
        exclude: this.garage.id,
        near: nearOf(place),
        ...(jobs.length > 0 && { jobTypeIds: jobs.join(',') }),
      });
      if (turn !== this.reads) return;
      this.nearby.set(items);
      this.nearbyState.set('ready');
      // A garage no longer listed for this car or these jobs leaves the ticks.
      const listed = new Set(items.map((g) => g.id));
      const ticked = this.form.controls.garageIds.value;
      if (ticked.some((id) => !listed.has(id)))
        this.form.controls.garageIds.setValue(
          ticked.filter((id) => listed.has(id)),
        );
    } catch {
      if (turn === this.reads) this.nearbyState.set('failed');
    }
  }

  // A garage that cannot receive leaves the ticks; the line names it.
  private refused(failure: unknown) {
    this.unreceivable.set(null);
    if (!(failure instanceof HttpErrorResponse)) return;
    const body = failure.error as Partial<GarageCannotReceiveProblem> | null;
    if (body?.code !== 'garage_cannot_receive' || !body.garageId) return;
    const { garageId } = body;
    const listed = this.nearby().find((g) => g.id === garageId)?.name;
    const name =
      body.garageName ||
      listed ||
      (garageId === this.garage.id ? this.garage.name : '');
    this.unreceivable.set({
      garageId,
      name,
      reason: knownReason(body.reason),
    });
    const ticked = this.form.controls.garageIds.value;
    if (ticked.includes(garageId))
      this.form.controls.garageIds.setValue(
        ticked.filter((id) => id !== garageId),
      );
  }

  private body(): CreateQuoteRequestDto {
    const value = this.form.getRawValue();
    const description = value.description.trim();
    return {
      carId: value.carId,
      description: description === '' ? null : description,
      garageIds: [this.garage.id, ...value.garageIds],
      jobTypeIds: value.jobTypeIds,
      sources: [
        this.task.data.source,
        ...value.garageIds.map(() => 'search' as const),
      ],
    };
  }
}
