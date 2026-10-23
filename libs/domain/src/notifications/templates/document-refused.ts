import type { DocumentKind } from '@motor-fix/contracts';

import type { Template } from '../templates';

const LABELS: Record<'ro' | 'en', Record<DocumentKind, string>> = {
  en: {
    onrc_certificate: 'ONRC company certificate',
    rar_authorisation: 'RAR authorisation',
  },
  ro: {
    onrc_certificate: 'Certificatul constatator ONRC',
    rar_authorisation: 'Autorizația RAR',
  },
};

export const documentLabel = (kind: DocumentKind, language: string) =>
  LABELS[language === 'en' ? 'en' : 'ro'][kind];

// To a garage's owners, when an admin refuses one of the yearly documents.
// The note is the admin's, shown as plain text; the push leaves it out, as
// it may run to 500 characters.
export const DOCUMENT_REFUSED: Template = {
  audience: 'garage',
  bell: {
    en: 'Document refused: {document}. {note}',
    ro: 'Document refuzat: {document}. {note}',
  },
  email: {
    en: {
      button: { label: 'Open your garage dashboard', link: 'dashboard' },
      lines: [
        'Document refused: {document}',
        'The MotorFix team’s note: {note}',
        'Upload it again from the documents row of your garage dashboard.',
      ],
      reason:
        'You get this e-mail because you own a garage on MotorFix and sent its yearly documents.',
      subject: 'Your documents were refused',
    },
    ro: {
      button: { label: 'Deschide panoul service-ului', link: 'dashboard' },
      lines: [
        'Document refuzat: {document}',
        'Nota echipei MotorFix: {note}',
        'Încarcă-l din nou din rândul Documente al panoului service-ului.',
      ],
      reason:
        'Primești acest e-mail pentru că ești proprietarul unui service pe MotorFix și i-ai trimis documentele anuale.',
      subject: 'Documentele au fost refuzate',
    },
  },
  example: {
    dashboard: 'https://motorfix.example/app/garage',
    document: LABELS.ro.rar_authorisation,
    note: 'Pagina a doua nu se citește',
  },
  push: {
    en: {
      body: 'Refused: {document}. The note is in your garage dashboard.',
      link: 'dashboard',
      title: 'Documents refused',
    },
    ro: {
      body: 'Refuzat: {document}. Nota e în panoul service-ului.',
      link: 'dashboard',
      title: 'Documente refuzate',
    },
  },
  values: { dashboard: 'link', document: 'text', note: 'text' },
};
