import type { Template } from '../templates';

// To a garage's owners, once an admin puts the suspended garage back on the
// map. It names the garage only: the cause and the admin's note stay in the
// history.

const REASON = {
  en: 'You get this e-mail because you own a garage on MotorFix; news about its place on the map is always sent.',
  ro: 'Primești acest e-mail pentru că ești proprietarul unui service pe MotorFix; vestea despre locul lui pe hartă se trimite întotdeauna.',
};

export const GARAGE_RESTORED: Template = {
  audience: 'garage',
  bell: {
    en: '{garage}: Your profile is back on the map.',
    ro: '{garage}: Profilul tău este din nou pe hartă.',
  },
  email: {
    en: {
      button: { label: 'Open your garage dashboard', link: 'link' },
      lines: [
        'Your profile is back on the map.',
        'Drivers can find and book you again.',
      ],
      reason: REASON.en,
      subject: '{garage}: your profile is back on the map',
    },
    ro: {
      button: { label: 'Deschide panoul service-ului', link: 'link' },
      lines: [
        'Profilul tău este din nou pe hartă.',
        'Clienții te pot găsi și rezerva din nou.',
      ],
      reason: REASON.ro,
      subject: '{garage}: profilul este din nou pe hartă',
    },
  },
  example: {
    garage: 'Atelier Dinamo',
    link: 'https://motorfix.example/app/garage',
  },
  push: {
    en: {
      body: 'Your profile is back on the map.',
      link: 'link',
      title: '{garage}',
    },
    ro: {
      body: 'Profilul tău este din nou pe hartă.',
      link: 'link',
      title: '{garage}',
    },
  },
  values: { garage: 'text', link: 'link' },
  whatsapp: {
    en: { name: 'motorfix_garage_restored_en', slots: ['{garage}', '{link}'] },
    ro: { name: 'motorfix_garage_restored_ro', slots: ['{garage}', '{link}'] },
  },
};
