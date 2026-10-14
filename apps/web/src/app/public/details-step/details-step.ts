import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  model,
  output,
} from '@angular/core';
import type { ListingCheck } from '@motor-fix/contracts/listing-check';
import {
  type BusinessKind,
  type DetailsSection,
  KNOWN_FOR_MAX,
  type MobileLegalForm,
  NAME_MAX,
  PHONE_MAX,
} from '@motor-fix/contracts/listing-sections';
import { TranslatePipe } from '@motor-fix/i18n';
import { HlmInput, HlmLabel } from '@motor-fix/ui-cockpit';

import { FieldWatch, NO_PROBLEMS } from '../field-watch';

type Text = 'name' | 'phone' | 'knownFor';

const KINDS: readonly { value: BusinessKind; label: string }[] = [
  { label: 'public.listing.details.kinds.company', value: 'company' },
  { label: 'public.listing.details.kinds.pfa', value: 'pfa' },
  { label: 'public.listing.details.kinds.ii', value: 'ii' },
  { label: 'public.listing.details.kinds.mobile', value: 'mobile' },
];
const LEGAL_FORMS: readonly { value: MobileLegalForm; label: string }[] = [
  { label: 'public.listing.details.legalForms.pfa', value: 'pfa' },
  { label: 'public.listing.details.legalForms.company', value: 'company' },
];

// Step 1 of listing a garage: the name, the phone, what the garage is best
// at and the kind of business. It holds the draft's section and saves
// nothing; the page judges it, and a field says what is wrong once it has
// been left, when it opens wrong, or when sending is asked for.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmInput, HlmLabel, TranslatePipe],
  selector: 'mf-details-step',
  styleUrl: './details-step.css',
  templateUrl: './details-step.html',
})
export class DetailsStep {
  readonly value = model<DetailsSection>({});
  // The page's judgement of this step, and whether sending was asked for.
  readonly problems = input<ListingCheck>(NO_PROBLEMS);
  readonly showAll = input(false);
  // Whether any field shows an error, for the step list's dot.
  readonly shown = output<boolean>();

  protected readonly kinds = KINDS;
  protected readonly legalForms = LEGAL_FORMS;
  protected readonly nameMax = NAME_MAX;
  protected readonly knownForMax = KNOWN_FOR_MAX;
  protected readonly phoneMax = PHONE_MAX;

  private readonly watch = new FieldWatch();

  protected readonly errors = computed(() => {
    const value = this.value();
    const check = this.problems();
    const all = this.showAll();
    const message = (field: string, filled: boolean) =>
      this.watch.message(check, field, { all, filled })?.key ?? null;
    const text = (field: Text) =>
      message(`steps.1.${field}`, !!value[field]?.trim());
    return {
      businessKind: message('steps.1.businessKind', false),
      knownFor: text('knownFor'),
      mobileLegalForm: message('steps.1.mobileLegalForm', false),
      name: text('name'),
      phone: text('phone'),
    };
  });

  constructor() {
    effect(() => this.shown.emit(Object.values(this.errors()).some(Boolean)));
  }

  protected type(field: Text, event: Event) {
    const typed = (event.target as HTMLInputElement).value;
    this.watch.type(`steps.1.${field}`);
    const { [field]: _, ...rest } = this.value();
    this.value.set(typed ? { ...rest, [field]: typed } : rest);
  }

  protected leave(field: Text) {
    this.watch.leave(`steps.1.${field}`);
  }

  // Another kind than mobile has no legal form to keep.
  protected choose(kind: BusinessKind) {
    const { mobileLegalForm, ...rest } = this.value();
    this.value.set(
      kind === 'mobile' && mobileLegalForm
        ? { ...rest, businessKind: kind, mobileLegalForm }
        : { ...rest, businessKind: kind },
    );
  }

  protected chooseForm(form: MobileLegalForm) {
    this.value.update((value) => ({ ...value, mobileLegalForm: form }));
  }
}
