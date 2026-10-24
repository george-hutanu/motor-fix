import { PAYMENTS } from '@motor-fix/contracts/garage-hours';
import { FUELS } from '@motor-fix/contracts/plate';
import type { PublicGarageDto } from '@motor-fix/data-access';
import { formatLei, type Language } from '@motor-fix/i18n';

type Translate = (key: string, params?: Record<string, string>) => string;

// The lines the public profile writes and the owner's profile view repeats,
// so the two read the same.

// "benzină · motorină · hibrid": the ticked fuels in the fixed order.
export const fuelLine = (fuels: readonly string[], t: Translate) =>
  FUELS.filter((fuel) => fuels.includes(fuel))
    .map((fuel) => t(`public.requestQuote.fuelWord.${fuel}`))
    .join(' · ');

// "gratuit", "150 lei / zi", or nothing for a paid car with no price.
export function carTerms(
  car: PublicGarageDto['courtesyCar'],
  language: Language,
  t: Translate,
) {
  if (!car) return '';
  if (!car.paid) return t('public.garageProfile.details.free');
  if (car.pricePerDayBani === undefined) return '';
  return t('public.garageProfile.details.perDay', {
    price: formatLei(car.pricePerDayBani, language),
  });
}

// "Plată: numerar, card", or nothing when no method is ticked.
export function paymentLine(
  methods: PublicGarageDto['paymentMethods'] | undefined,
  t: Translate,
) {
  const ticked = PAYMENTS.filter((method) => methods?.[method]).map((method) =>
    t(`public.garageProfile.details.payments.${method}`),
  );
  return ticked.length
    ? t('public.garageProfile.details.payment', { methods: ticked.join(', ') })
    : '';
}
