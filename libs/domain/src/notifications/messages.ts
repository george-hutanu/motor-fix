type Language = 'ro' | 'en';
interface Mail {
  subject: string;
  text: string;
}

// Plain texts for the messages this module sends itself; every other type's
// own texts come with the templates.
const TEXTS = {
  en: {
    email_check: (link: string) => ({
      subject: 'Confirm your e-mail address',
      text: `Open this link to confirm your e-mail address for MotorFix:\n\n${link}\n\nIf you did not ask for it, ignore this e-mail.`,
    }),
    generic: {
      subject: 'You have a new notification',
      text: 'Open MotorFix to see it.',
    },
    grouped: (count: number) => ({
      subject: `You have ${count} new notifications`,
      text: 'Open MotorFix to see them.',
    }),
    password_reset: (link: string) => ({
      subject: 'Reset your password',
      text: `Open this link to choose a new MotorFix password:\n\n${link}\n\nIf you did not ask for it, ignore this e-mail; your password stays the same.`,
    }),
    quotes: (count: number) => ({
      subject: `${count} new quotes`,
      text: 'Open MotorFix to compare them.',
    }),
    test: {
      subject: 'MotorFix test message',
      text: 'This is a test message from MotorFix. E-mail reaches you.',
    },
  },
  ro: {
    email_check: (link: string) => ({
      subject: 'Confirmă adresa de e-mail',
      text: `Deschide acest link ca să confirmi adresa de e-mail pentru MotorFix:\n\n${link}\n\nDacă nu ai cerut asta, ignoră acest e-mail.`,
    }),
    generic: {
      subject: 'Ai o notificare nouă',
      text: 'Deschide MotorFix ca s-o vezi.',
    },
    grouped: (count: number) => ({
      subject: `Ai ${count} notificări noi`,
      text: 'Deschide MotorFix ca să le vezi.',
    }),
    password_reset: (link: string) => ({
      subject: 'Resetează parola',
      text: `Deschide acest link ca să alegi o parolă nouă pentru MotorFix:\n\n${link}\n\nDacă nu ai cerut asta, ignoră acest e-mail; parola rămâne aceeași.`,
    }),
    quotes: (count: number) => ({
      subject: `${count} oferte noi`,
      text: 'Deschide MotorFix ca să le compari.',
    }),
    test: {
      subject: 'Mesaj de test MotorFix',
      text: 'Acesta este un mesaj de test de la MotorFix. E-mailul ajunge la tine.',
    },
  },
};

export function message(
  kind: string,
  language: Language,
  params: Record<string, unknown>,
): Mail {
  const texts = TEXTS[language];
  if (kind === 'TEST_MESSAGE') return texts.test;
  if (kind === 'ACCOUNT_EMAIL') {
    const link = String(params['link']);
    return params['purpose'] === 'password_reset'
      ? texts.password_reset(link)
      : texts.email_check(link);
  }
  return texts.generic;
}

export function groupedMessage(
  kind: string,
  count: number,
  language: Language,
): Mail {
  return kind === 'QUOTE_RECEIVED'
    ? TEXTS[language].quotes(count)
    : TEXTS[language].grouped(count);
}
