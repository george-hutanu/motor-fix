import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { SavedGarageItemDto } from '@motor-fix/data-access';
import { formatKm, I18n, TranslatePipe } from '@motor-fix/i18n';
import { Lamp, type LampState, RatingDial } from '@motor-fix/ui-cockpit';

// One saved garage: a link to its profile with the small rating dial, its
// name and a lamp line (does it work on the driver's cars, and how far), and
// beside the link its own remove button.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Lamp, RatingDial, RouterLink, TranslatePipe],
  selector: 'mf-saved-garage-row',
  styleUrl: './saved-garage-row.css',
  templateUrl: './saved-garage-row.html',
})
export class SavedGarageRow {
  readonly item = input.required<SavedGarageItemDto>();
  // False once the driver is known to have no car; undefined while the cars
  // are not known, when an empty brand list says nothing either way.
  readonly hasCar = input<boolean | undefined>(true);
  readonly removed = output<string>();
  private readonly i18n = inject(I18n);
  protected readonly language = this.i18n.language;

  protected readonly lamp = computed<LampState | null>(() => {
    const hasCar = this.hasCar();
    if (hasCar === false) return 'grey';
    if (this.item().brands.length) return 'green';
    return hasCar ? 'red' : null;
  });

  protected readonly line = computed(() => {
    const item = this.item();
    if (!item.available) return this.i18n.t('driver.saved.unavailable');
    const names = item.brands.map((brand) => brand.name);
    const works = this.works(names, this.language());
    return [works, this.where(item)].filter(Boolean).join(' · ');
  });

  private works(names: readonly string[], language: string) {
    const t = (key: string, params = {}) =>
      this.i18n.t(`driver.saved.${key}`, params);
    const hasCar = this.hasCar();
    if (hasCar === false) return t('noCar');
    if (names.length) {
      return t('worksOn', {
        brands: new Intl.ListFormat(language === 'en' ? 'en-GB' : 'ro', {
          type: 'conjunction',
        }).format(names),
      });
    }
    return hasCar ? t('worksOnNone') : null;
  }

  // A mobile mechanic says whether it comes to the place, never a distance.
  private where(item: SavedGarageItemDto) {
    if (item.businessKind === 'mobile') {
      if (item.comesToYou === undefined) return null;
      return this.i18n.t(
        item.comesToYou
          ? 'driver.saved.comesToYou'
          : 'driver.saved.outsideArea',
      );
    }
    return typeof item.distanceKm === 'number'
      ? formatKm(item.distanceKm, this.language())
      : null;
  }
}
