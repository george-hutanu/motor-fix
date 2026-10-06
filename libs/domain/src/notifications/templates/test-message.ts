import type { Template } from '../templates';

export const TEST_MESSAGE: Template = {
  audience: 'any',
  bell: {
    en: 'Test message: notifications work.',
    ro: 'Mesaj de test: notificările funcționează.',
  },
  email: {
    en: {
      button: { label: 'Open MotorFix', link: 'app' },
      lines: ['This is a test message from MotorFix.', 'E-mail reaches you.'],
      reason:
        'You get this e-mail because a MotorFix admin sent a test message to your account.',
      subject: 'MotorFix test message',
    },
    ro: {
      button: { label: 'Deschide MotorFix', link: 'app' },
      lines: [
        'Acesta este un mesaj de test de la MotorFix.',
        'E-mailul ajunge la tine.',
      ],
      reason:
        'Primești acest e-mail pentru că un administrator MotorFix a trimis un mesaj de test contului tău.',
      subject: 'Mesaj de test MotorFix',
    },
  },
  example: {},
  push: {
    en: {
      body: 'Notifications reach this device.',
      link: 'app',
      title: 'MotorFix test message',
    },
    ro: {
      body: 'Notificările ajung pe acest dispozitiv.',
      link: 'app',
      title: 'Mesaj de test MotorFix',
    },
  },
  values: {},
};
