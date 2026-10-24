import { carTerms, fuelLine, paymentLine } from './detail-lines';

// @traces 133-FR-007 133-FR-008

const t = (key: string, params?: Record<string, string>) =>
  params ? `${key}(${Object.values(params).join(',')})` : key;

describe('the detail lines the public profile and the owner view share', () => {
  it('writes the ticked fuels in the fixed order, whatever order they come in', () => {
    expect(fuelLine(['electric', 'petrol', 'hybrid'], t)).toBe(
      'public.requestQuote.fuelWord.petrol · public.requestQuote.fuelWord.hybrid · public.requestQuote.fuelWord.electric',
    );
    expect(fuelLine([], t)).toBe('');
  });

  it('gives a free car, a priced car and a paid car with no price', () => {
    expect(carTerms({ paid: false }, 'ro', t)).toBe(
      'public.garageProfile.details.free',
    );
    expect(carTerms({ paid: true, pricePerDayBani: 15000 }, 'ro', t)).toMatch(
      /^public\.garageProfile\.details\.perDay\(150/,
    );
    expect(carTerms({ paid: true }, 'ro', t)).toBe('');
    expect(carTerms(undefined, 'ro', t)).toBe('');
  });

  it('lists the ticked payment methods in the fixed order, or nothing', () => {
    expect(paymentLine({ card: true, cash: true, transfer: false }, t)).toBe(
      'public.garageProfile.details.payment(public.garageProfile.details.payments.cash, public.garageProfile.details.payments.card)',
    );
    expect(paymentLine({ card: false, cash: false, transfer: false }, t)).toBe(
      '',
    );
    expect(paymentLine(undefined, t)).toBe('');
  });
});
