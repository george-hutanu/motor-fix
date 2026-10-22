import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  Injector,
  inject,
  linkedSignal,
  type OnInit,
  signal,
} from '@angular/core';
import {
  FEATURE_KEYS,
  type FeatureKey,
} from '@motor-fix/contracts/listing-survey';
import { GaragesService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays, toProblem } from '@motor-fix/overlays';
import { HlmSwitch } from '@motor-fix/ui-cockpit';

import {
  FeatureOffConfirm,
  type FeatureOffConfirmData,
} from '../feature-off-confirm/feature-off-confirm';
import { garageOf, Session } from '../session';

type States = Record<FeatureKey, boolean>;

const statesOf = (features: Record<string, boolean> | undefined) =>
  Object.fromEntries(
    FEATURE_KEYS.map((key) => [key, features?.[key] ?? true]),
  ) as States;

// Unique ids for the descriptions when the panel is shown more than once.
let panels = 0;

// The owner's five feature switches: on saves at once, off asks first.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmSwitch, TranslatePipe],
  selector: 'mf-feature-switches',
  styleUrl: './feature-switches.css',
  templateUrl: './feature-switches.html',
})
export class FeatureSwitches implements OnInit {
  private readonly api = inject(GaragesService);
  private readonly i18n = inject(I18n);
  private readonly injector = inject(Injector);
  private readonly overlays = inject(Overlays);
  private readonly session = inject(Session);

  protected readonly id = `features-${++panels}`;
  protected readonly rows = FEATURE_KEYS.map((key) => ({
    description: `garage.features.description.${key}`,
    key,
    name: `garage.features.name.${key}`,
  }));
  // Follows the account's re-read (another tab's change), and each answer.
  protected readonly states = linkedSignal(() =>
    statesOf(garageOf(this.session.current())?.features),
  );
  protected readonly busy = signal<ReadonlySet<FeatureKey>>(new Set());
  protected readonly errors = signal<Partial<Record<FeatureKey, string>>>({});

  ngOnInit() {
    void this.i18n.enter('garage');
  }

  protected async toggle(
    key: FeatureKey,
    enabled: boolean,
    control: HlmSwitch,
  ) {
    if (!enabled) {
      // Off moves the switch only once confirmed. Its inner switch already
      // flipped itself, so it is set back once that flip has rendered: set back
      // before, its binding would see no change.
      afterNextRender(() => control.checked.set(true), {
        injector: this.injector,
      });
      if (!(await this.confirmed(key))) return;
    }
    const garageId = this.session.current()?.garageId;
    if (!garageId) return;
    this.mark(key, true);
    this.say(key, null);
    this.states.update((states) => ({ ...states, [key]: enabled }));
    try {
      const answer = await this.api.garageFeaturesControllerSet({
        body: { enabled },
        feature: key,
        garageId,
      });
      this.states.set(statesOf({ ...answer.features }));
    } catch (error) {
      this.states.update((states) => ({ ...states, [key]: !enabled }));
      this.say(
        key,
        toProblem(error).code === 'mechanics_on_team'
          ? 'garage.features.mechanicsOnTeam'
          : 'garage.features.saveFailed',
      );
    } finally {
      this.mark(key, false);
    }
  }

  private async confirmed(key: FeatureKey) {
    const answer = await this.overlays.open<true, FeatureOffConfirmData>(
      FeatureOffConfirm,
      {
        data: { key },
        shape: 'dialog',
        title: 'garage.features.confirm.title',
        titleParams: { name: this.i18n.t(`garage.features.name.${key}`) },
      },
    );
    return answer === true;
  }

  private mark(key: FeatureKey, on: boolean) {
    this.busy.update((busy) => {
      const next = new Set(busy);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  private say(key: FeatureKey, message: string | null) {
    this.errors.update((errors) => {
      const { [key]: _, ...rest } = errors;
      return message ? { ...rest, [key]: message } : rest;
    });
  }
}
