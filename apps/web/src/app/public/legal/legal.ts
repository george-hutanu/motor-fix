import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { I18n, TranslatePipe } from '@motor-fix/i18n';

import { LEGAL_TEXTS, type LegalText } from '../legal-texts';

// The terms of use or the privacy notice, whole, rendered on the server and
// open to anyone: the sign-up tick links here in a new tab.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  selector: 'mf-legal',
  styleUrl: './legal.css',
  templateUrl: './legal.html',
})
export class Legal {
  private readonly language = inject(I18n).language;
  private readonly text: LegalText =
    inject(ActivatedRoute).snapshot.data['text'];

  protected readonly document = computed(
    () => LEGAL_TEXTS[this.language()][this.text],
  );
}
