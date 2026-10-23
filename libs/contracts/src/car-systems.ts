// The systems of a car a catalogue job belongs to, set by the admin who
// approves it; each with its Romanian and English label.
export const CAR_SYSTEMS = [
  'engine',
  'transmission',
  'brakes',
  'suspension_steering',
  'electrical',
  'air_con',
  'body',
  'tyres_wheels',
  'general',
] as const;

export type CarSystem = (typeof CAR_SYSTEMS)[number];

export const CAR_SYSTEM_LABELS: Record<CarSystem, { ro: string; en: string }> =
  {
    air_con: { en: 'Air conditioning', ro: 'Climatizare' },
    body: { en: 'Body', ro: 'Caroserie' },
    brakes: { en: 'Brakes', ro: 'Frâne' },
    electrical: { en: 'Electrical', ro: 'Sistem electric' },
    engine: { en: 'Engine', ro: 'Motor' },
    general: { en: 'General', ro: 'General' },
    suspension_steering: {
      en: 'Suspension and steering',
      ro: 'Suspensie și direcție',
    },
    transmission: { en: 'Transmission', ro: 'Transmisie' },
    tyres_wheels: { en: 'Tyres and wheels', ro: 'Anvelope și roți' },
  };
