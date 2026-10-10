import type { HomeGarageDto } from '@motor-fix/data-access';
import { formatKm, type I18n } from '@motor-fix/i18n';

export interface Where {
  city: string;
  rest: string;
}

// Where a garage on Home is: the city is a name from its address, shown as
// written in either language (marked translate="no" by the template); the
// rest is said in the current one. A mobile mechanic has no city; the cards
// also say its area (`area`), the dial's leader line does not.
export function garageWhere(
  garage: HomeGarageDto,
  i18n: I18n,
  { area = false } = {},
): Where | null {
  if (garage.businessKind === 'mobile') {
    const mobile = i18n.t('public.home.dial.mobile');
    return {
      city: '',
      rest:
        area && garage.serviceRadiusKm !== undefined
          ? `${mobile} · ${i18n.t('public.home.cards.area', { km: garage.serviceRadiusKm })}`
          : mobile,
    };
  }
  const city = garage.city ?? '';
  const km =
    typeof garage.distanceKm === 'number'
      ? formatKm(garage.distanceKm, i18n.language())
      : '';
  if (!city && !km) return null;
  return { city, rest: city && km ? ` · ${km}` : km };
}
