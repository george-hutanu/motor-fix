import {
  ChangeDetectionStrategy,
  Component,
  computed,
  model,
  signal,
} from '@angular/core';
import {
  type BusinessKind,
  type DetailsSection,
  isRomanianPhone,
  KNOWN_FOR_MAX,
  type MobileLegalForm,
  NAME_MAX,
  NAME_MIN,
  normalisePhone,
} from '@motor-fix/contracts';
import { TranslatePipe } from '@motor-fix/i18n';
import { HlmInput, HlmLabel } from '@motor-fix/ui-cockpit';

type Text = 'name' | 'phone' | 'knownFor';

const KEY = 'public.listing.details';

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

function nameError(name = '') {
  const length = name.trim().length;
  return length < NAME_MIN || length > NAME_MAX ? `${KEY}.nameLength` : null;
}

function phoneError(phone = '') {
  if (!phone.trim()) return `${KEY}.phoneNeeded`;
  const normalised = normalisePhone(phone);
  return normalised && isRomanianPhone(normalised)
    ? null
    : `${KEY}.phoneRomanian`;
}

const knownForError = (knownFor = '') =>
  knownFor.trim() ? null : `${KEY}.knownForNeeded`;

// Step 1 of listing a garage: the name, the phone, what the garage is best
// at and the kind of business. It holds the draft's section and saves
// nothing; a field says what is wrong only once it has been left.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmInput, HlmLabel, TranslatePipe],
  selector: 'mf-details-step',
  styleUrl: './details-step.css',
  templateUrl: './details-step.html',
})
export class DetailsStep {
  readonly value = model<DetailsSection>({});

  protected readonly kinds = KINDS;
  protected readonly legalForms = LEGAL_FORMS;
  protected readonly nameMax = NAME_MAX;
  protected readonly knownForMax = KNOWN_FOR_MAX;

  private readonly left = signal<ReadonlySet<Text>>(new Set());

  protected readonly errors = computed(() => {
    const { knownFor, name, phone } = this.value();
    const left = this.left();
    const shown = (field: Text, error: string | null) =>
      left.has(field) ? error : null;
    return {
      knownFor: shown('knownFor', knownForError(knownFor)),
      name: shown('name', nameError(name)),
      phone: shown('phone', phoneError(phone)),
    };
  });

  protected type(field: Text, event: Event) {
    const typed = (event.target as HTMLInputElement).value;
    const { [field]: _, ...rest } = this.value();
    this.value.set(typed ? { ...rest, [field]: typed } : rest);
  }

  protected leave(field: Text) {
    if (!this.left().has(field))
      this.left.update((left) => new Set([...left, field]));
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
