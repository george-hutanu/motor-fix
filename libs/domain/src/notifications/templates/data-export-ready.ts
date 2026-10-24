import type { Template } from '../templates';

// To the account itself once its copy is stored; the button opens Setări,
// where the download waits for seven days.
export const DATA_EXPORT_READY: Template = {
  audience: 'any',
  bell: {
    en: 'Your data file is ready.',
    ro: 'Fișierul tău cu date e gata.',
  },
  email: {
    en: {
      button: { label: 'Open Settings', link: 'link' },
      lines: [
        'The file with your MotorFix data is ready. Download it from Settings within 7 days; after that it is deleted and you can ask for a new one.',
      ],
      reason:
        'You get this e-mail because a copy of the data of this MotorFix account was asked for. If it was not you, change your password now.',
      subject: 'Your data file is ready',
    },
    ro: {
      button: { label: 'Deschide Setări', link: 'link' },
      lines: [
        'Fișierul cu datele tale din MotorFix e gata. Descarcă-l din Setări în 7 zile; după aceea se șterge și poți cere unul nou.',
      ],
      reason:
        'Primești acest e-mail pentru că s-a cerut o copie a datelor acestui cont MotorFix. Dacă nu ai fost tu, schimbă parola acum.',
      subject: 'Fișierul tău cu date e gata',
    },
  },
  example: { link: 'https://motorfix.example/ro/app/driver/settings' },
  values: { link: 'link' },
};
