import { PRIVACY_VERSION, TERMS_VERSION } from '@motor-fix/contracts/consent';

// The terms of use and the privacy notice an account accepts at sign-up. A
// change to either text is a new version: a new date in
// libs/contracts/src/consent.ts. Both languages hold the same sections and
// paragraphs in the same order. The privacy notice states facts of the code
// (what is kept, for how long, by whom); a change to one of those facts
// changes the text too. Kept out of the i18n files, which hold interface
// strings, not documents.

export type LegalText = 'terms' | 'privacy';
type Section = { heading: string; paragraphs: readonly string[] };
type LegalDocument = {
  title: string;
  version: string;
  sections: readonly Section[];
};

export const LEGAL_LABELS = {
  en: { version: 'Version' },
  ro: { version: 'Versiunea' },
} as const;

export const LEGAL_TEXTS: Record<
  'ro' | 'en',
  Record<LegalText, LegalDocument>
> = {
  en: {
    privacy: {
      sections: [
        {
          heading: 'Who runs MotorFix and how to reach us',
          paragraphs: [
            'MotorFix runs this service and decides how the personal data in it is used: it is the controller of that data. The company’s legal name, registration number and address will be added to this notice, as a new version, once the company is set up.',
            'For anything about your data, write to us from your account. If you have no account, create one and write to us from it; we use it only to answer you, and you may ask us to close it afterwards.',
          ],
        },
        {
          heading: 'What data we keep and why',
          paragraphs: [
            'Your account: your name, e-mail address, phone number, language and city, and the ways you sign in (e-mail and password, Google, Apple, or a phone number with a code sent by WhatsApp). We also keep when you were last active and whether e-mail to your address bounced. We need these to run your account and to reach you.',
            'Your cars: brand, model, year, fuel, odometer reading and the due dates for ITP, RCA and the road vignette (rovinietă). The number plate is private: only the garage working on your car sees it, and it appears on that garage’s day sheets. We use these to remind you of due dates and to send your requests.',
            'Requests, quotes and bookings, when you use them: what you ask for, the quotes garages send you, your bookings, the one message you can add to a request, the garage’s reply and up to 3 photos on each. We keep them so that you and the garage can agree on the work and see what was agreed.',
            'Your repair history, when you use it: the repairs done through MotorFix, the repairs you log from elsewhere with their invoices, the history you share with a garage (one booking at a time) and a car’s history you pass on to its buyer.',
            'Reviews, reports and appeals, when you use them: a review shows its author as a first name and an initial, for example “Andrei M.”. We keep reports and appeals to decide on them and to show how we decided.',
            'The audit history: every change made in the service is recorded with who made it and when, including changes made later through an AI assistant you connect. It lets you, the garage and us see what happened, and settle disagreements.',
            'Garages: the legal documents a garage sends and the results of our checks, the garage’s staff (mechanics and receptionists) and the mechanics’ public pages. While a garage’s listing is unfinished we keep it together with the e-mail address it was started with.',
            'Notifications: the messages we send you and the channel you chose for each. For push messages we keep a label of your device, taken from your browser’s description.',
            'Consents: when you accepted these texts and which version, and your choices about news and analytics, with when you made them. We keep them to show what you agreed to.',
          ],
        },
        {
          heading: 'Why we may use it',
          paragraphs: [
            'Your account and the service itself rest on the contract between you and MotorFix: the terms of use you accept when you create the account. What the law requires us to keep, we keep because of that legal obligation.',
            'News and analytics rest on your consent, which you may withdraw at any time. Profile-view counts, the security and anti-abuse measures and the verification of garages rest on our legitimate interest in keeping the service honest, safe and useful to garages.',
          ],
        },
        {
          heading: 'Who else handles the data',
          paragraphs: [
            'Some providers handle personal data for us, each under a data processing agreement and only for what we ask: Railway hosts the service in a European Union region; Brevo sends our e-mail, SMS and WhatsApp messages; S3-compatible object storage in a European Union region keeps photos and documents.',
            'Push messages go through the push service of your browser’s maker, with their content encrypted end to end. Grafana Cloud, in a European Union region, receives monitoring data and error reports from our servers and from your browser. Your browser sends its error reports to Grafana Cloud directly, so it sees your connection address. Plausible measures visits only if you agree to analytics.',
            'OpenFreeMap supplies map images, which your browser loads directly, so it sees your connection address. Geoapify answers address searches, which our server sends, so it never sees your address. Google and Apple sign you in when you choose them. If you connect an AI assistant, what it reads at your request goes to that assistant’s provider.',
            'Personal data is stored in the European Union. Where a provider or its parent company is outside the European Economic Area, transfers rely on the European Commission’s standard contractual clauses or on the EU-US Data Privacy Framework.',
          ],
        },
        {
          heading: 'How long we keep it',
          paragraphs: [
            'Account data stays while the account exists; after it is closed, only what the law requires, for as long as it requires. To close your account or have your data erased, write to us from your account; we handle it ourselves until you can do it in the service.',
            'Legal documents and the audit history stay while the garage or the account is active, then 5 years at most.',
            'Photos on requests and replies stay 90 days at most. A garage’s workshop photos stay while its listing shows them.',
            'An unfinished garage listing is deleted 90 days after its last change. Consent records stay as long as we need them to show what was accepted. Profile-view data is kept as the next section says.',
          ],
        },
        {
          heading: 'Profile views',
          paragraphs: [
            'We count how many different people see a garage’s public profile each day, to show the garage how many people it reaches. If you are signed in, you are counted by your account.',
            'If you are not signed in, you are counted by a one-way key: an HMAC (a one-way keyed hash) of your connection address and your browser’s description, made under a secret of 32 random bytes that is created fresh every day (Romanian time). The secret is held only in our short-lived in-memory store and is discarded at the end of that day, so the key cannot be turned back into your address and a new day gives a new key.',
            'The key is kept only in daily counters, which are discarded within two days: at the end of the second day after the day counted. After that we keep only the daily totals per garage and per way of arriving at the profile. Your address and browser description are used only for that key and for the anti-abuse limit described below; we do not store or log them, and our servers do not send them to the monitoring provider.',
            'Bots, the garage’s own staff and MotorFix’s administrators are not counted. Nothing is placed on your device and nothing is read from it, not even a cookie, so we do not ask for your consent.',
            'This counting rests on our legitimate interest (GDPR Art. 6(1)(f)) in showing garages how many people saw their profile. You may object to it at any time by writing to us from your account.',
          ],
        },
        {
          heading: 'Security and anti-abuse measures',
          paragraphs: [
            "To stop abuse we count the requests that come from one connection address, keeping only a one-way hash of the address, never the address itself: for 60 seconds for profile views, place searches and assistant sign-ins, for 15 minutes for failed sign-ins, and for 1 hour for sign-ups, password resets, consent records, garage listings in progress and WhatsApp sign-in codes. While you watch a garage's live page, your address is held in memory only, to limit how many live pages one address opens at once, and is dropped when the page closes.",
            'A car’s number plate is hidden from everyone but the garage working on the car.',
          ],
        },
        {
          heading: 'Cookies and browser storage',
          paragraphs: [
            'We use only the cookies the service needs to sign you in: the session cookie mf_refresh, kept up to 30 days if you choose “Keep me signed in”, otherwise until you close the browser, and two cookies of a Google or Apple sign-in (mf_oauth and mf_oauth_pending), which last 10 minutes.',
            'Your browser also keeps, on your device, your analytics choice, the place you chose, an unfinished garage listing and the actions waiting for a connection. Plausible loads only after you agree to analytics.',
          ],
        },
        {
          heading: 'News and analytics',
          paragraphs: [
            'News by e-mail and analytics are separate consents, asked for apart from these texts, and you can withdraw each at any time without affecting what came before. Change your news choice in your account’s notification settings or with the link in every news e-mail; change your analytics choice in “Cookie settings”, at the bottom of every page.',
          ],
        },
        {
          heading: 'Your rights',
          paragraphs: [
            'You have the right to see your data, to have it corrected or erased, to restrict its use, to receive it in a portable form, to object to its use and to withdraw a consent without affecting what came before. To use any of these rights, write to us from your account.',
            'You may also complain to the National Supervisory Authority for Personal Data Processing (ANSPDCP).',
          ],
        },
        {
          heading: 'Changes to this notice',
          paragraphs: [
            'When this notice changes we publish the new version here, with its date at the top.',
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
            'MotorFix helps drivers in Romania find a garage or a mechanic for their car and keep their car’s history. The garages are independent: each answers for its own work and its own quotes.',
          ],
        },
        {
          heading: 'Your account',
          paragraphs: [
            'You may create an account if you are 18 or over. A garage is listed by a person entitled to act for it.',
            'You give true details, keep one account, keep your sign-in to yourself and tell us if someone else uses your account.',
          ],
        },
        {
          heading: 'What drivers can do',
          paragraphs: [
            'As a driver you can add your cars, send requests to garages, compare their quotes, book, keep your repair history, share it with a garage and pass a car’s history on to its buyer.',
          ],
        },
        {
          heading: 'What garages can do',
          paragraphs: [
            'As a garage you can list your business, answer requests with quotes, plan your work on day sheets, add your staff and give your mechanics public pages.',
          ],
        },
        {
          heading: 'Listing and verification',
          paragraphs: [
            'A garage lists itself with true legal documents. MotorFix checks them and may approve, refuse or suspend a listing.',
            'A garage may appeal a refusal or a suspension by writing to us from its account; we answer with our reasons.',
          ],
        },
        {
          heading: 'Reviews, reports and appeals',
          paragraphs: [
            'A review may only be about work actually done, and shows its author as a first name and an initial, for example “Andrei M.”.',
            'Anyone may report a review that breaks these rules, and its author or the garage may appeal our decision. MotorFix may remove a review that breaks these rules.',
          ],
        },
        {
          heading: 'Money',
          paragraphs: [
            'MotorFix is free at launch, for drivers and for garages. It takes no payments and is not a party to the repair contract between you and the garage. How MotorFix will earn money is decided later and announced as a new version of these terms.',
          ],
        },
        {
          heading: 'Acceptable use and suspension',
          paragraphs: [
            'You use MotorFix only for your own cars, requests and business, and never to mislead, harass, send unwanted messages, copy the service in bulk or get around its limits. Breaking these terms may lead us to suspend or close your account.',
          ],
        },
        {
          heading: 'Liability',
          paragraphs: [
            'MotorFix answers for running the service with care, within the limits Romanian law allows. It does not answer for the work, the prices or the promises of a garage, which are between you and that garage.',
          ],
        },
        {
          heading: 'Closing your account',
          paragraphs: [
            'You may close your account at any time by writing to us from your account; we close it and keep only what the privacy notice says.',
          ],
        },
        {
          heading: 'Changes to these terms',
          paragraphs: [
            'When these terms change we publish the new version here, with its date.',
          ],
        },
        {
          heading: 'Governing law and contact',
          paragraphs: [
            'These terms are governed by Romanian law. You can write to us from your account about anything in them.',
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
          heading: 'Cine se ocupă de MotorFix și cum ne contactezi',
          paragraphs: [
            'MotorFix administrează acest serviciu și decide cum sunt folosite datele personale din el: este operatorul acestor date. Denumirea legală a firmei, numărul de înregistrare și adresa vor fi adăugate în această notă, ca versiune nouă, după înființarea firmei.',
            'Pentru orice privește datele tale, ne scrii din contul tău. Dacă nu ai cont, îți creezi unul și ne scrii din el; îl folosim doar ca să îți răspundem și ne poți cere apoi să îl închidem.',
          ],
        },
        {
          heading: 'Ce date păstrăm și de ce',
          paragraphs: [
            'Contul tău: numele, adresa de e‑mail, numărul de telefon, limba și orașul, plus felurile în care intri în cont (e‑mail și parolă, Google, Apple sau un număr de telefon cu un cod trimis pe WhatsApp). Mai păstrăm când ai fost activ ultima dată și dacă e‑mailurile către adresa ta s‑au întors. Avem nevoie de ele ca să funcționeze contul și ca să te putem contacta.',
            'Mașinile tale: marca, modelul, anul, combustibilul, kilometrajul și scadențele pentru ITP, RCA și rovinietă. Numărul de înmatriculare este privat: îl vede doar service‑ul care lucrează la mașina ta și apare pe foile zilei ale acelui service. Le folosim ca să îți amintim de scadențe și ca să îți trimitem cererile.',
            'Cereri, oferte și programări, când le folosești: ce ceri, ofertele primite de la service‑uri, programările tale, mesajul pe care îl poți adăuga la o cerere, răspunsul service‑ului și cel mult 3 fotografii la fiecare. Le păstrăm ca tu și service‑ul să vă înțelegeți asupra lucrării și să vedeți ce s‑a stabilit.',
            'Istoricul reparațiilor, când îl folosești: reparațiile făcute prin MotorFix, reparațiile făcute în altă parte pe care le adaugi, cu facturile lor, istoricul pe care îl arăți unui service (câte o programare) și istoricul unei mașini pe care îl dai cumpărătorului ei.',
            'Recenzii, semnalări și contestații, când le folosești: o recenzie își arată autorul prin prenume și inițială, de exemplu „Andrei M.”. Păstrăm semnalările și contestațiile ca să decidem asupra lor și ca să arătăm cum am decis.',
            'Istoricul modificărilor: fiecare schimbare făcută în serviciu este înregistrată cu cine a făcut‑o și când, inclusiv schimbările făcute mai târziu printr‑un asistent AI pe care îl conectezi. Așa tu, service‑ul și noi putem vedea ce s‑a întâmplat și lămuri neînțelegerile.',
            'Service‑urile: documentele legale trimise de un service și rezultatele verificărilor noastre, personalul service‑ului (mecanici și recepționeri) și paginile publice ale mecanicilor. Cât timp înscrierea unui service nu e terminată, o păstrăm împreună cu adresa de e‑mail cu care a fost începută.',
            'Notificările: mesajele pe care ți le trimitem și canalul ales pentru fiecare. Pentru notificările push păstrăm o etichetă a dispozitivului, luată din descrierea browserului tău.',
            'Acordurile: când ai acceptat aceste texte și ce versiune, plus alegerile tale privind noutățile și analiza vizitelor, cu momentul în care le‑ai făcut. Le păstrăm ca să arătăm la ce ți‑ai dat acordul.',
          ],
        },
        {
          heading: 'De ce avem voie să le folosim',
          paragraphs: [
            'Contul și serviciul se bazează pe contractul dintre tine și MotorFix: termenii de utilizare pe care îi accepți când îți creezi contul. Ce ne cere legea să păstrăm, păstrăm pentru că avem această obligație legală.',
            'Noutățile și analiza vizitelor se bazează pe acordul tău, pe care îl poți retrage oricând. Numărarea vizualizărilor de profil, măsurile de securitate și împotriva abuzurilor și verificarea service‑urilor se bazează pe interesul nostru legitim de a ține serviciul corect, sigur și util pentru service‑uri.',
          ],
        },
        {
          heading: 'Cine mai prelucrează datele',
          paragraphs: [
            'Unii furnizori prelucrează date personale pentru noi, fiecare pe baza unui acord de prelucrare a datelor și doar pentru ce le cerem: Railway găzduiește serviciul într‑o regiune din Uniunea Europeană; Brevo trimite mesajele noastre pe e‑mail, SMS și WhatsApp; un spațiu de stocare compatibil S3, într‑o regiune din Uniunea Europeană, păstrează fotografiile și documentele.',
            'Notificările push trec prin serviciul push al producătorului browserului tău, cu conținutul criptat integral. Grafana Cloud, într‑o regiune din Uniunea Europeană, primește datele de monitorizare și rapoartele de erori de la serverele noastre și din browserul tău. Browserul tău îi trimite direct rapoartele de erori, deci Grafana Cloud vede adresa conexiunii tale. Plausible măsoară vizitele doar dacă ești de acord cu analiza vizitelor.',
            'OpenFreeMap furnizează imaginile hărții, pe care browserul tău le încarcă direct, deci vede adresa conexiunii tale. Geoapify răspunde la căutările de adrese, pe care le trimite serverul nostru, deci nu vede niciodată adresa ta. Google și Apple te autentifică atunci când îi alegi. Dacă conectezi un asistent AI, ce citește acesta la cererea ta ajunge la furnizorul acelui asistent.',
            'Datele personale sunt stocate în Uniunea Europeană. Când un furnizor sau firma lui mamă se află în afara Spațiului Economic European, transferurile se bazează pe clauzele contractuale standard ale Comisiei Europene sau pe Cadrul UE‑SUA privind protecția datelor (Data Privacy Framework).',
          ],
        },
        {
          heading: 'Cât timp le păstrăm',
          paragraphs: [
            'Datele contului rămân cât timp există contul; după închidere, doar ce cere legea, cât timp cere. Ca să îți închizi contul sau să îți fie șterse datele, ne scrii din contul tău; ne ocupăm noi de asta până când vei putea face singur acest lucru în serviciu.',
            'Documentele legale și istoricul modificărilor rămân cât timp service‑ul sau contul este activ, apoi cel mult 5 ani.',
            'Fotografiile din cereri și răspunsuri rămân cel mult 90 de zile. Fotografiile atelierului unui service rămân cât timp înscrierea lui le arată.',
            'O înscriere de service neterminată se șterge la 90 de zile după ultima ei modificare. Acordurile rămân cât timp avem nevoie să arătăm ce s‑a acceptat. Datele despre vizualizările de profil se păstrează cum spune secțiunea următoare.',
          ],
        },
        {
          heading: 'Vizualizările profilului',
          paragraphs: [
            'Numărăm câte persoane diferite văd în fiecare zi profilul public al unui service, ca să îi arătăm service‑ului câți oameni ajung la el. Dacă ești autentificat, ești numărat după contul tău.',
            'Dacă nu ești autentificat, ești numărat după o cheie într‑un singur sens: un HMAC (o amprentă criptografică cu cheie, într‑un singur sens) al adresei conexiunii tale și al descrierii browserului tău, făcut cu un secret de 32 de octeți aleatori creat din nou în fiecare zi (după ora României). Secretul este ținut doar în memoria de scurtă durată a serviciului și este aruncat la sfârșitul acelei zile, așa că din cheie nu se poate afla adresa ta, iar o zi nouă dă o cheie nouă.',
            'Cheia este păstrată doar în contoarele zilnice, aruncate în cel mult două zile: la sfârșitul celei de‑a doua zile de după ziua numărată. După aceea păstrăm doar totalurile zilnice pe service și pe felul în care s‑a ajuns la profil. Adresa și descrierea browserului sunt folosite doar pentru această cheie și pentru limita împotriva abuzurilor descrisă mai jos; nu le stocăm, nu le înregistrăm în jurnale, iar serverele noastre nu le trimit furnizorului de monitorizare.',
            'Roboții, personalul service‑ului și administratorii MotorFix nu sunt numărați. Nu punem nimic pe dispozitivul tău și nu citim nimic de pe el, nici măcar un cookie, așa că nu îți cerem acordul.',
            'Această numărare se bazează pe interesul nostru legitim (GDPR art. 6 alin. (1) lit. f) de a le arăta service‑urilor câți oameni le‑au văzut profilul. Te poți opune oricând acestei numărări, scriindu‑ne din contul tău.',
          ],
        },
        {
          heading: 'Măsuri de securitate și împotriva abuzurilor',
          paragraphs: [
            'Ca să oprim abuzurile, numărăm cererile venite de la aceeași adresă de conexiune, păstrând doar o amprentă într‑un singur sens a adresei, niciodată adresa însăși: timp de 60 de secunde pentru vizualizările de profil, căutările de locuri și autentificările asistenților, timp de 15 minute pentru autentificările eșuate și timp de o oră pentru conturile noi, resetările de parolă, acordurile, înscrierile de service în curs și codurile de autentificare prin WhatsApp. Cât timp urmărești pagina live a unui service, adresa ta este ținută doar în memorie, ca să limităm câte pagini live deschide aceeași adresă deodată, și este ștearsă când pagina se închide.',
            'Numărul de înmatriculare al unei mașini este ascuns tuturor, în afară de service‑ul care lucrează la mașină.',
          ],
        },
        {
          heading: 'Cookie‑uri și stocarea în browser',
          paragraphs: [
            'Folosim doar cookie‑urile de care serviciul are nevoie ca să te autentifice: cookie‑ul de sesiune mf_refresh, păstrat până la 30 de zile dacă alegi „Ține‑mă autentificat”, altfel până închizi browserul, și două cookie‑uri ale autentificării cu Google sau Apple (mf_oauth și mf_oauth_pending), care durează 10 minute.',
            'Browserul tău mai păstrează, pe dispozitiv, alegerea ta privind analiza vizitelor, locul ales, o înscriere de service neterminată și acțiunile care așteaptă o conexiune. Plausible se încarcă doar după ce ești de acord cu analiza vizitelor.',
          ],
        },
        {
          heading: 'Noutăți și analiza vizitelor',
          paragraphs: [
            'Noutățile pe e‑mail și analiza vizitelor sunt acorduri separate, cerute separat de aceste texte, și le poți retrage pe fiecare oricând, fără să afecteze ce a fost înainte. Noutățile le schimbi din setările de notificări ale contului sau cu linkul din fiecare e‑mail cu noutăți; analiza vizitelor o schimbi din „Setări cookie”, în josul fiecărei pagini.',
          ],
        },
        {
          heading: 'Drepturile tale',
          paragraphs: [
            'Ai dreptul să îți vezi datele, să ceri corectarea sau ștergerea lor, să restrângi folosirea lor, să le primești într‑o formă portabilă, să te opui folosirii lor și să îți retragi un acord fără să afecteze ce a fost înainte. Ca să folosești oricare dintre aceste drepturi, ne scrii din contul tău.',
            'Poți face și plângere la Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP).',
          ],
        },
        {
          heading: 'Schimbarea acestei note',
          paragraphs: [
            'Când această notă se schimbă, publicăm aici noua versiune, cu data ei în partea de sus.',
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
            'MotorFix îi ajută pe șoferii din România să găsească un service sau un mecanic pentru mașina lor și să păstreze istoricul mașinii. Service‑urile sunt independente: fiecare răspunde pentru lucrările și ofertele sale.',
          ],
        },
        {
          heading: 'Contul tău',
          paragraphs: [
            'Îți poți crea un cont dacă ai cel puțin 18 ani. Un service este înscris de o persoană care are dreptul să acționeze în numele lui.',
            'Dai date adevărate, ai un singur cont, nu dai nimănui datele de autentificare și ne spui dacă altcineva îți folosește contul.',
          ],
        },
        {
          heading: 'Ce pot face șoferii',
          paragraphs: [
            'Ca șofer îți poți adăuga mașinile, trimite cereri service‑urilor, compara ofertele lor, face programări, păstra istoricul reparațiilor, îl poți arăta unui service și poți da istoricul unei mașini cumpărătorului ei.',
          ],
        },
        {
          heading: 'Ce pot face service‑urile',
          paragraphs: [
            'Ca service îți poți înscrie afacerea, răspunde la cereri cu oferte, planifica lucrul pe foile zilei, adăuga personalul și face pagini publice pentru mecanici.',
          ],
        },
        {
          heading: 'Înscrierea și verificarea',
          paragraphs: [
            'Un service se înscrie cu documente legale adevărate. MotorFix le verifică și poate aproba, refuza sau suspenda o înscriere.',
            'Un service poate contesta un refuz sau o suspendare scriindu‑ne din contul său; îi răspundem cu motivele noastre.',
          ],
        },
        {
          heading: 'Recenzii, semnalări și contestații',
          paragraphs: [
            'O recenzie poate fi doar despre o lucrare făcută cu adevărat și își arată autorul prin prenume și inițială, de exemplu „Andrei M.”.',
            'Oricine poate semnala o recenzie care încalcă aceste reguli, iar autorul ei sau service‑ul poate contesta decizia noastră. MotorFix poate șterge o recenzie care încalcă aceste reguli.',
          ],
        },
        {
          heading: 'Bani',
          paragraphs: [
            'MotorFix este gratuit la lansare, pentru șoferi și pentru service‑uri. Nu încasează plăți și nu este parte în contractul de reparație dintre tine și service. Cum va câștiga MotorFix bani se decide mai târziu și se anunță ca versiune nouă a acestor termeni.',
          ],
        },
        {
          heading: 'Folosirea corectă și suspendarea',
          paragraphs: [
            'Folosești MotorFix doar pentru mașinile, cererile și afacerea ta și niciodată ca să induci în eroare, să hărțuiești, să trimiți mesaje nedorite, să copiezi serviciul în masă sau să ocolești limitele lui. Încălcarea acestor termeni poate duce la suspendarea sau închiderea contului tău.',
          ],
        },
        {
          heading: 'Răspunderea',
          paragraphs: [
            'MotorFix răspunde pentru funcționarea cu grijă a serviciului, în limitele permise de legea română. Nu răspunde pentru lucrările, prețurile sau promisiunile unui service, care sunt între tine și acel service.',
          ],
        },
        {
          heading: 'Închiderea contului',
          paragraphs: [
            'Îți poți închide contul oricând, scriindu‑ne din contul tău; îl închidem și păstrăm doar ce spune nota de informare privind datele personale.',
          ],
        },
        {
          heading: 'Schimbarea termenilor',
          paragraphs: [
            'Când acești termeni se schimbă, publicăm aici noua versiune, cu data ei.',
          ],
        },
        {
          heading: 'Legea aplicabilă și contact',
          paragraphs: [
            'Acești termeni sunt guvernați de legea română. Ne poți scrie din contul tău despre orice din ei.',
          ],
        },
      ],
      title: 'Termeni de utilizare',
      version: TERMS_VERSION,
    },
  },
};
