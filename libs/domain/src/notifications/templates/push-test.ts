import type { Template } from '../templates';

// The test a signed-in person sends to their own devices.
export const PUSH_TEST: Template = {
  audience: 'any',
  bell: {
    en: 'Test notification sent to your devices.',
    ro: 'Notificare de test trimisă pe dispozitivele tale.',
  },
  example: {},
  push: {
    en: {
      body: 'Notifications work on this device.',
      link: 'app',
      title: 'MotorFix test notification',
    },
    ro: {
      body: 'Notificările funcționează pe acest dispozitiv.',
      link: 'app',
      title: 'Notificare de test MotorFix',
    },
  },
  values: {},
};
