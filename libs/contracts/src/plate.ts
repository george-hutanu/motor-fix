// The car's shape both the API and the dialog check, kept here because the
// browser imports this file and not the validators.
export const FUELS = ['petrol', 'diesel', 'hybrid', 'electric'] as const;
export const MAX_KM = 2_000_000;
export const STORED_PLATE = /^[A-Z0-9]{2,12}$/;

const ROMANIAN = /^([A-Z]{1,2})(\d{2,3})([A-Z]{3})$/;

// A plate as stored: upper case, without the spaces and hyphens people type.
export function normalisePlate(text: string): string {
  return text.replace(/[\s-]/g, '').toUpperCase();
}

// A county or B, two or three digits, three letters. Anything else is only
// warned about: foreign and special plates are real too.
export function isRomanianPlate(stored: string): boolean {
  return ROMANIAN.test(stored);
}

export function groupPlate(stored: string): string {
  const parts = ROMANIAN.exec(stored);
  return parts ? parts.slice(1).join(' ') : stored;
}
