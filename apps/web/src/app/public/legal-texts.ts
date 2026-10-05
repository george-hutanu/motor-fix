import { PRIVACY_VERSION, TERMS_VERSION } from '@motor-fix/contracts/consent';

// The terms of use and the privacy notice an account accepts at sign-up. They
// are drafts until the legal review: the final texts replace these and move
// the version in libs/contracts/src/consent.ts. Kept out of the i18n files,
// which hold interface strings, not documents.

export type LegalText = 'terms' | 'privacy';
type Section = { heading: string; paragraphs: readonly string[] };
type Document = {
  title: string;
  version: string;
  sections: readonly Section[];
};

export const LEGAL_LABELS = {
  en: { draft: 'Draft text, pending legal review.', version: 'Version' },
  ro: {
    draft: 'Text provizoriu, în curs de revizuire juridică.',
    version: 'Versiunea',
  },
} as const;

export const LEGAL_TEXTS: Record<'ro' | 'en', Record<LegalText, Document>> = {
  en: {
    privacy: {
      sections: [
        {
          heading: 'Who handles your data',
          paragraphs: [
            'MotorFix handles the personal data you give when you create an account and use the service, as the controller of that data.',
          ],
        },
        {
          heading: 'What we collect',
          paragraphs: [
            'Your name, your e-mail address or phone number, the language you chose, the way you sign in, and the cars, requests and reviews you add.',
            'We also record when you accepted these texts, and which version.',
          ],
        },
        {
          heading: 'Why we use it',
          paragraphs: [
            'To run your account, to put you in touch with the garages you choose, and to send you the messages you asked for. News messages need your separate agreement, which you can withdraw at any time.',
          ],
        },
        {
          heading: 'How long we keep it',
          paragraphs: [
            'For as long as your account exists, and afterwards only as long as the law requires.',
          ],
        },
        {
          heading: 'Your rights',
          paragraphs: [
            'You may ask to see, correct, export or delete your data, object to its use, and complain to the National Supervisory Authority for Personal Data Processing (ANSPDCP).',
          ],
        },
      ],
      title: 'Privacy notice',
      version: PRIVACY_VERSION,
    },
    terms: {
      sections: [
        {
          heading: 'What MotorFix is',
          paragraphs: [
            'MotorFix helps drivers in Romania find a garage or a mechanic for their car. The garages are independent and answer for their own work.',
          ],
        },
        {
          heading: 'Your account',
          paragraphs: [
            'You give true details, keep your password to yourself and tell us if someone else uses your account.',
          ],
        },
        {
          heading: 'Using the service',
          paragraphs: [
            'You use MotorFix only for your own cars and requests, and you write reviews about work you actually had done.',
          ],
        },
        {
          heading: 'Changes to these terms',
          paragraphs: [
            'When these terms change we publish the new version here, with its date.',
          ],
        },
        {
          heading: 'Contact',
          paragraphs: [
            'You can write to us from your account about anything in these terms.',
          ],
        },
      ],
      title: 'Terms of use',
      version: TERMS_VERSION,
    },
  },
  ro: {
    privacy: {
      sections: [
        {
          heading: 'Cine prelucrează datele tale',
          paragraphs: [
            'MotorFix prelucrează datele personale pe care le dai când îți creezi contul și folosești serviciul, în calitate de operator.',
          ],
        },
        {
          heading: 'Ce date colectăm',
          paragraphs: [
            'Numele, adresa de e‑mail sau numărul de telefon, limba aleasă, felul în care intri în cont și mașinile, cererile și recenziile pe care le adaugi.',
            'Păstrăm și momentul în care ai acceptat aceste texte, cu versiunea lor.',
          ],
        },
        {
          heading: 'De ce le folosim',
          paragraphs: [
            'Ca să funcționeze contul tău, ca să te punem în legătură cu service‑urile alese și ca să îți trimitem mesajele cerute. Noutățile au nevoie de acordul tău separat, pe care îl poți retrage oricând.',
          ],
        },
        {
          heading: 'Cât timp le păstrăm',
          paragraphs: [
            'Cât timp există contul și, după aceea, doar cât cere legea.',
          ],
        },
        {
          heading: 'Drepturile tale',
          paragraphs: [
            'Poți cere să îți vezi, corectezi, exporți sau ștergi datele, te poți opune folosirii lor și poți face plângere la Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP).',
          ],
        },
      ],
      title: 'Nota de informare privind datele personale',
      version: PRIVACY_VERSION,
    },
    terms: {
      sections: [
        {
          heading: 'Ce este MotorFix',
          paragraphs: [
            'MotorFix îi ajută pe șoferii din România să găsească un service sau un mecanic pentru mașina lor. Service‑urile sunt independente și răspund pentru lucrările lor.',
          ],
        },
        {
          heading: 'Contul tău',
          paragraphs: [
            'Dai date adevărate, îți păstrezi parola doar pentru tine și ne spui dacă altcineva îți folosește contul.',
          ],
        },
        {
          heading: 'Folosirea serviciului',
          paragraphs: [
            'Folosești MotorFix doar pentru mașinile și cererile tale și scrii recenzii doar despre lucrări făcute cu adevărat.',
          ],
        },
        {
          heading: 'Schimbarea termenilor',
          paragraphs: [
            'Când acești termeni se schimbă, publicăm aici noua versiune, cu data ei.',
          ],
        },
        {
          heading: 'Contact',
          paragraphs: [
            'Ne poți scrie din contul tău despre orice din acești termeni.',
          ],
        },
      ],
      title: 'Termeni de utilizare',
      version: TERMS_VERSION,
    },
  },
};
