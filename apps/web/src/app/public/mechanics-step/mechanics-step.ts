import {
  ChangeDetectionStrategy,
  Component,
  computed,
  model,
  signal,
} from '@angular/core';
import {
  MECHANIC_NAME_MAX,
  MECHANIC_NAME_MIN,
  MECHANICS_MAX,
  type MechanicCard,
  type MechanicsSection,
  SPECIALITY_MAX,
} from '@motor-fix/contracts';
import { TranslatePipe } from '@motor-fix/i18n';
import { HlmButton, HlmInput, HlmSwitch } from '@motor-fix/ui-cockpit';

import { initials } from '../../dashboard/initials';

// Step 4 of listing a garage, optional: the mechanics as cards without an
// account, and whether they show on the page. It holds the draft's section
// and saves nothing.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmInput, HlmSwitch, TranslatePipe],
  selector: 'mf-mechanics-step',
  styleUrl: './mechanics-step.css',
  templateUrl: './mechanics-step.html',
})
export class MechanicsStep {
  readonly value = model<MechanicsSection>({});

  protected readonly nameMax = MECHANIC_NAME_MAX;
  protected readonly specialityMax = SPECIALITY_MAX;
  protected readonly initials = initials;

  // Rows whose name field has been left, by position.
  private readonly left = signal<ReadonlySet<number>>(new Set());

  protected readonly cards = computed(() => this.value().mechanics ?? []);
  protected readonly full = computed(
    () => this.cards().length >= MECHANICS_MAX,
  );

  protected nameError(card: MechanicCard, index: number) {
    return (
      this.left().has(index) && card.name.trim().length < MECHANIC_NAME_MIN
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
    this.left.set(new Set());
    const cards = this.cards().filter((_, i) => i !== index);
    this.setCards(cards);
  }

  protected leave(index: number) {
    if (!this.left().has(index))
      this.left.update((left) => new Set([...left, index]));
  }

  protected type(index: number, key: keyof MechanicCard, event: Event) {
    const typed = (event.target as HTMLInputElement).value;
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
