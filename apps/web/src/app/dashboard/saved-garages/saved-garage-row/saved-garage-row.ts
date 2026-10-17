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
  // False only once the driver is known to have no car.
  readonly hasCar = input(true);
  readonly removed = output<string>();
  private readonly i18n = inject(I18n);
  protected readonly language = this.i18n.language;

  protected readonly lamp = computed<LampState>(() => {
    if (!this.hasCar()) return 'grey';
    return this.item().brands.length ? 'green' : 'red';
  });

  protected readonly line = computed(() => {
    const item = this.item();
    const t = (key: string, params = {}) =>
      this.i18n.t(`driver.saved.${key}`, params);
    if (!item.available) return t('unavailable');
    const language = this.language();
    const names = item.brands.map((brand) => brand.name);
    const works = !this.hasCar()
      ? t('noCar')
      : names.length
        ? t('worksOn', {
            brands: new Intl.ListFormat(language === 'en' ? 'en-GB' : 'ro', {
              type: 'conjunction',
            }).format(names),
          })
        : t('worksOnNone');
    const where = this.where(item);
    return where ? `${works} · ${where}` : works;
  });

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
