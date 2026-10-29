import type { Template } from '../templates';

// To the seller, once the buyer took the car over. Names the car only, never
// the buyer. Each WhatsApp name is a template registered with Brevo.
export const CAR_TRANSFER_ACCEPTED: Template = {
  audience: 'driver',
  bell: {
    en: 'The buyer has taken over your {car}. Its history stays with you, read-only, up to the sale date.',
    ro: 'Mașina {car} a fost preluată de cumpărător. Istoricul ei rămâne la tine, doar pentru citire, până la data vânzării.',
  },
  email: {
    en: {
      button: { label: 'See sold cars', link: 'link' },
      lines: [
        'The buyer has taken over your {car}. Its history stays with you, read-only, up to the sale date.',
      ],
      reason:
        'You get this e-mail because you sent a car to its buyer on MotorFix.',
      subject: 'Your {car} has been taken over',
    },
    ro: {
      button: { label: 'Vezi mașinile vândute', link: 'link' },
      lines: [
        'Mașina {car} a fost preluată de cumpărător. Istoricul ei rămâne la tine, doar pentru citire, până la data vânzării.',
      ],
      reason:
        'Primești acest e-mail pentru că ai trimis o mașină cumpărătorului ei pe MotorFix.',
      subject: '{car} a fost preluată',
    },
  },
  example: {
    car: 'Mini Cooper S',
    link: 'https://motorfix.example/app/driver?view=cars',
  },
  push: {
    en: {
      body: 'The buyer has taken over your {car}. Its history stays with you, read-only, up to the sale date.',
      link: 'link',
      title: 'Car taken over',
    },
    ro: {
      // The bell's line runs past the 120-character push limit in Romanian.
      body: 'Mașina {car} a fost preluată. Istoricul ei rămâne la tine, doar pentru citire.',
      link: 'link',
      title: 'Mașină preluată',
    },
  },
  values: { car: 'text', link: 'link' },
  whatsapp: {
    en: { name: 'motorfix_car_transfer_accepted_en', slots: ['{car}'] },
    ro: { name: 'motorfix_car_transfer_accepted_ro', slots: ['{car}'] },
  },
};
