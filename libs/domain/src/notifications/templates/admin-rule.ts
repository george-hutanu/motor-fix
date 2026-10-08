import type { Template } from '../templates';

// Another admin asked to switch the reviews rule off and waits for a second
// admin. `brief` is the asker and the reason, cut to fit a push.
export const ADMIN_RULE_APPROVAL_NEEDED: Template = {
  audience: 'admin',
  bell: {
    en: '{name} asks to switch off "Reviews only after a confirmed job".',
    ro: '{name} cere oprirea regulii „Recenzii doar după o lucrare confirmată”.',
  },
  email: {
    en: {
      button: { label: 'Open Settings', link: 'settings' },
      lines: [
        '{name} asks to switch off the rule "Reviews only after a confirmed job". Another admin has to approve.',
        'Reason: {reason}',
      ],
      reason:
        'You get this e-mail because you are a MotorFix admin and a rule change waits for a second admin.',
      subject: '{name} asks to switch off a rule',
    },
    ro: {
      button: { label: 'Deschide Setări', link: 'settings' },
      lines: [
        '{name} cere oprirea regulii „Recenzii doar după o lucrare confirmată”. Un alt administrator trebuie să aprobe.',
        'Motiv: {reason}',
      ],
      reason:
        'Primești acest e-mail pentru că ești administrator MotorFix și o schimbare de regulă așteaptă un al doilea administrator.',
      subject: '{name} cere oprirea unei reguli',
    },
  },
  example: {
    brief: 'Ioana: Testăm recenziile din profil.',
    name: 'Ioana',
    reason: 'Testăm recenziile din profil.',
    settings: 'https://motorfix.example/app/admin/settings',
  },
  push: {
    en: { body: '{brief}', link: 'settings', title: 'A rule waits for you' },
    ro: {
      body: '{brief}',
      link: 'settings',
      title: 'O regulă așteaptă aprobarea',
    },
  },
  values: { brief: 'text', name: 'text', reason: 'text', settings: 'link' },
};
