export interface Step6Values {
  cui: string;
  rarNumber: string;
}

type Five = [boolean, boolean, boolean, boolean, boolean];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' ? value : '');

// The two values from whatever the draft holds; anything but text reads empty.
export function readStep6(data: unknown): Step6Values {
  const steps = isRecord(data) ? data['steps'] : undefined;
  const section = isRecord(steps) ? steps['6'] : undefined;
  if (!isRecord(section)) return { cui: '', rarNumber: '' };
  return { cui: text(section['cui']), rarNumber: text(section['rarNumber']) };
}

export const completedCount = (done: Five): number =>
  done.filter(Boolean).length;
