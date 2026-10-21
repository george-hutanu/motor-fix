// An amount in lei as a Romanian driver types it, kept here because the
// browser imports this file and not the validators.
export const PAID_BANI_MAX = 100_000_000;

type LeiText =
  | { bani: number }
  | { error: 'decimals' | 'format' | 'max' | 'min' };

const AMOUNT = /^(-?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?$/;

// "4.200,50 lei" is 420050 bani: a dot groups thousands, a comma starts bani.
export function parseLeiText(text: string): LeiText {
  const amount = AMOUNT.exec(text.replace(/\s+/g, '').replace(/lei$/i, ''));
  if (!amount) return { error: 'format' };
  const [, minus, lei, bani = ''] = amount;
  if (bani.length > 2) return { error: 'decimals' };
  const value =
    Number(lei.replaceAll('.', '')) * 100 + Number(bani.padEnd(2, '0'));
  if (minus || value === 0) return { error: 'min' };
  if (value > PAID_BANI_MAX) return { error: 'max' };
  return { bani: value };
}
