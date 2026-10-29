import type { Template } from '../templates';

// To the account whose assistant asked to act: the approval's sheet holds
// what it would do, so the message only links to it.
export const ASSISTANT_APPROVAL_NEEDED: Template = {
  audience: 'any',
  bell: {
    en: 'Your assistant wants to do something. Approve it in the app.',
    ro: 'Asistentul tău vrea să facă ceva. Aprobă în aplicație.',
  },
  email: {
    en: {
      button: { label: 'Open the request', link: 'link' },
      lines: [
        'Your assistant wants to do something in your MotorFix account and waits for your approval.',
        'Approve or refuse it in the app within 30 minutes; after that the request expires.',
      ],
      reason:
        'You get this e-mail because you connected an assistant to your MotorFix account and have no device with notifications on.',
      subject: "Approve your assistant's action",
    },
    ro: {
      button: { label: 'Deschide cererea', link: 'link' },
      lines: [
        'Asistentul tău vrea să facă ceva în contul tău MotorFix și așteaptă aprobarea ta.',
        'Aprobă sau refuză în aplicație în 30 de minute; după aceea cererea expiră.',
      ],
      reason:
        'Primești acest e-mail pentru că ai conectat un asistent la contul tău MotorFix și nu ai un dispozitiv cu notificările pornite.',
      subject: 'Aprobă acțiunea asistentului tău',
    },
  },
  example: {
    link: 'https://motorfix.example/app/assistant/approvals/6f1c2a3e-1d4b-4a8e-9c1f-2b3d4e5f6a7b',
  },
  push: {
    en: {
      body: 'Approve or refuse it in the app within 30 minutes.',
      link: 'link',
      title: 'Your assistant wants to do something',
    },
    ro: {
      body: 'Aprobă sau refuză în aplicație în 30 de minute.',
      link: 'link',
      title: 'Asistentul tău vrea să facă ceva',
    },
  },
  values: { link: 'link' },
};
