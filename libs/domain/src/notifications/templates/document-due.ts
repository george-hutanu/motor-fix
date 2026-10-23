import type { Template } from '../templates';

// To a garage's owners, 30, 7 and 0 days before the yearly documents are due.
// Always sent, by e-mail and push.
export const DOCUMENT_DUE: Template = {
  audience: 'garage',
  bell: {
    en: 'Upload your yearly documents again by {dueOn}',
    ro: 'Reîncarcă documentele anuale până pe {dueOn}',
  },
  email: {
    en: {
      button: { label: 'Open your garage dashboard', link: 'dashboard' },
      lines: [
        'Upload your yearly documents again by {dueOn}',
        'The ONRC company certificate and the RAR authorisation are checked once a year. Upload them from the documents row of your garage dashboard.',
      ],
      reason:
        'You get this e-mail because you own a garage on MotorFix; the yearly documents reminder is always sent.',
      subject: 'Upload your yearly documents again by {dueOn}',
    },
    ro: {
      button: { label: 'Deschide panoul service-ului', link: 'dashboard' },
      lines: [
        'Reîncarcă documentele anuale până pe {dueOn}',
        'Certificatul constatator ONRC și autorizația RAR se verifică o dată pe an. Încarcă-le din rândul Documente al panoului service-ului.',
      ],
      reason:
        'Primești acest e-mail pentru că ești proprietarul unui service pe MotorFix; amintirea documentelor anuale se trimite întotdeauna.',
      subject: 'Reîncarcă documentele anuale până pe {dueOn}',
    },
  },
  example: {
    dashboard: 'https://motorfix.example/app/garage',
    dueOn: '2027-01-15',
  },
  push: {
    en: {
      body: 'Upload your yearly documents again by {dueOn}',
      link: 'dashboard',
      title: 'Yearly documents',
    },
    ro: {
      body: 'Reîncarcă documentele anuale până pe {dueOn}',
      link: 'dashboard',
      title: 'Documentele anuale',
    },
  },
  values: { dashboard: 'link', dueOn: 'day' },
};
