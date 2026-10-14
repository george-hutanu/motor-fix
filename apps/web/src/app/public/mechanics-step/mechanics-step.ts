import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import type { ListingCheck } from '@motor-fix/contracts/listing-check';
import {
  MECHANIC_NAME_MAX,
  MECHANICS_MAX,
  type MechanicCard,
  type MechanicsSection,
  SPECIALITY_MAX,
} from '@motor-fix/contracts/listing-sections';
import { TranslatePipe } from '@motor-fix/i18n';
import { HlmButton, HlmInput, HlmSwitch } from '@motor-fix/ui-cockpit';

import { initials } from '../../dashboard/initials';
import { FieldWatch, NO_PROBLEMS } from '../field-watch';

const nameField = (index: number) => `steps.4.mechanics[${index}].name`;

// Step 4 of listing a garage, optional: the mechanics as cards without an
// account, and whether they show on the page. It holds the draft's section
// and saves nothing; the page judges it, and a name says what is wrong once
// it has been left, when it opens wrong, or when sending is asked for.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmInput, HlmSwitch, TranslatePipe],
  selector: 'mf-mechanics-step',
  styleUrl: './mechanics-step.css',
  templateUrl: './mechanics-step.html',
})
export class MechanicsStep {
  readonly value = model<MechanicsSection>({});
  // The page's judgement of this step, and whether sending was asked for.
  readonly problems = input<ListingCheck>(NO_PROBLEMS);
  readonly showAll = input(false);
  // Whether any field shows an error, for the step list's dot.
  readonly shown = output<boolean>();

  protected readonly nameMax = MECHANIC_NAME_MAX;
  protected readonly specialityMax = SPECIALITY_MAX;
  protected readonly initials = initials;

  // Rows are watched by position, so a removed row starts the watch again.
  private readonly watch = signal(new FieldWatch());

  protected readonly cards = computed(() => this.value().mechanics ?? []);
  protected readonly full = computed(
    () => this.cards().length >= MECHANICS_MAX,
  );

  // Each row's name message, by position.
  protected readonly nameErrors = computed(() => {
    const check = this.problems();
    const all = this.showAll();
    const watch = this.watch();
    return this.cards().map((card, i) =>
      watch.message(check, nameField(i), { all, filled: !!card.name.trim() }),
    );
  });

  protected readonly nameField = nameField;

  constructor() {
    effect(() =>
      this.shown.emit(
        this.nameErrors().some((message) => message && !message.warning),
      ),
    );
  }

  protected show(on: boolean) {
    this.value.update((value) => ({ ...value, onProfile: on }));
  }

  protected add() {
    if (this.full()) return;
    this.setCards([...this.cards(), { name: '' }]);
  }

  protected drop(index: number) {
    this.watch.set(new FieldWatch());
    const cards = this.cards().filter((_, i) => i !== index);
    this.setCards(cards);
  }

  protected leave(index: number) {
    this.watch().leave(nameField(index));
  }

  protected type(index: number, key: keyof MechanicCard, event: Event) {
    const typed = (event.target as HTMLInputElement).value;
    if (key === 'name') this.watch().type(nameField(index));
    this.setCards(
      this.cards().map((card, i) => {
        if (i !== index) return card;
        if (key === 'name') return { ...card, name: typed };
        const { speciality: _, ...rest } = card;
        return typed ? { ...rest, speciality: typed } : rest;
      }),
    );
  }

  private setCards(cards: MechanicCard[]) {
    const { mechanics: _, ...rest } = this.value();
    this.value.set(cards.length ? { ...rest, mechanics: cards } : rest);
  }
}
