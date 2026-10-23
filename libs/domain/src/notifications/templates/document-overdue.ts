import type { Template } from '../templates';

// To a garage's owners, the day after the yearly documents were due. The
// suspension day is the day after the grace ends. Always sent, by e-mail and
// push.
const LINE = {
  en: 'Your yearly documents were due on {dueOn}: upload them, otherwise the profile will be suspended on {suspendOn}',
  ro: 'Documentele anuale erau de reîncărcat până pe {dueOn}: încarcă-le, altfel profilul va fi suspendat pe {suspendOn}',
};

export const DOCUMENT_OVERDUE: Template = {
  audience: 'garage',
  bell: LINE,
  email: {
    en: {
      button: { label: 'Open your garage dashboard', link: 'dashboard' },
      lines: [
        LINE.en,
        'Upload the ONRC company certificate and the RAR authorisation from the documents row of your garage dashboard.',
      ],
      reason:
        'You get this e-mail because you own a garage on MotorFix; the yearly documents reminder is always sent.',
      subject: 'Your yearly documents are overdue',
    },
    ro: {
      button: { label: 'Deschide panoul service-ului', link: 'dashboard' },
      lines: [
        LINE.ro,
        'Încarcă certificatul constatator ONRC și autorizația RAR din rândul Documente al panoului service-ului.',
      ],
      reason:
        'Primești acest e-mail pentru că ești proprietarul unui service pe MotorFix; amintirea documentelor anuale se trimite întotdeauna.',
      subject: 'Documentele anuale sunt restante',
    },
  },
  example: {
    dashboard: 'https://motorfix.example/app/garage',
    dueOn: '2027-01-15',
    suspendOn: '2027-01-30',
  },
  push: {
    en: {
      body: 'Upload them, otherwise the profile will be suspended on {suspendOn}.',
      link: 'dashboard',
      title: 'Yearly documents overdue',
    },
    ro: {
      body: 'Încarcă-le, altfel profilul va fi suspendat pe {suspendOn}.',
      link: 'dashboard',
      title: 'Documentele anuale sunt restante',
    },
  },
  values: { dashboard: 'link', dueOn: 'day', suspendOn: 'day' },
};
