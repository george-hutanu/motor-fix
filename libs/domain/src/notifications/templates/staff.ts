import type { Template } from '../templates';

const invite = (
  ro: { as: string; extra: string },
  en: { as: string; extra: string },
): Template => ({
  audience: 'any',
  email: {
    en: {
      button: { label: 'Open the invitation', link: 'link' },
      lines: [
        `{garage} invites you to join its team on MotorFix ${en.as}.`,
        en.extra,
      ],
      reason:
        'You get this e-mail because a MotorFix garage invited this address to its team. If you do not know the garage, ignore it; the link stops working in 7 days.',
      subject: 'Invitation from {garage}',
    },
    ro: {
      button: { label: 'Deschide invitația', link: 'link' },
      lines: [
        `{garage} te invită în echipa sa pe MotorFix ${ro.as}.`,
        ro.extra,
      ],
      reason:
        'Primești acest e-mail pentru că un service MotorFix a invitat această adresă în echipa sa. Dacă nu cunoști service-ul, ignoră-l; linkul nu mai funcționează după 7 zile.',
      subject: 'Invitație de la {garage}',
    },
  },
  example: {
    garage: 'Atelier Dinamo',
    link: 'https://motorfix.example/ro/invite/example',
  },
  values: { garage: 'text', link: 'link' },
});

// The invitee may have no account yet: these go to the typed address only.
export const STAFF_INVITE_MECHANIC = invite(
  {
    as: 'ca mecanic',
    extra:
      'Dacă accepți, vei apărea pe profilul public al service-ului; poți fi ascuns mai târziu.',
  },
  {
    as: 'as a mechanic',
    extra:
      "If you accept, you will appear on the garage's public profile; you can be hidden later.",
  },
);

export const STAFF_INVITE_RECEPTIONIST = invite(
  {
    as: 'ca recepționer',
    extra: 'Deschide linkul ca să accepți, cu contul tău sau cu unul nou.',
  },
  {
    as: 'as a receptionist',
    extra: 'Open the link to accept, with your account or a new one.',
  },
);

// To the owner, once an invitee accepted.
export const STAFF_JOINED: Template = {
  audience: 'garage',
  bell: {
    en: '{name} joined the team of {garage}.',
    ro: '{name} s-a alăturat echipei {garage}.',
  },
  email: {
    en: {
      button: { label: 'Open MotorFix', link: 'app' },
      lines: [
        '{name} accepted your invitation and joined the team of {garage}.',
      ],
      reason:
        'You get this e-mail because you invited this person to your garage on MotorFix.',
      subject: '{name} joined your team',
    },
    ro: {
      button: { label: 'Deschide MotorFix', link: 'app' },
      lines: ['{name} a acceptat invitația și s-a alăturat echipei {garage}.'],
      reason:
        'Primești acest e-mail pentru că ai invitat această persoană în service-ul tău pe MotorFix.',
      subject: '{name} s-a alăturat echipei tale',
    },
  },
  example: { garage: 'Atelier Dinamo', name: 'Elena Stan' },
  values: { garage: 'text', name: 'text' },
};
