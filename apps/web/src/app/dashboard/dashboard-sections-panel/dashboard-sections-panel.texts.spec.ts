import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const panel = (language: 'ro' | 'en') =>
  (
    JSON.parse(
      readFileSync(
        join(
          __dirname,
          `../../../../../../libs/i18n/src/garage/${language}.json`,
        ),
        'utf8',
      ),
    ) as {
      home: {
        panel: {
          name: Record<string, string>;
          description: Record<string, string>;
          count: string;
          button: string;
        };
      };
    }
  ).home.panel;

// @traces 011-FR-005
describe('the panel texts', () => {
  it.each([
    ['kpi', 'Cifrele zilei', 'Cereri noi, programări, notă, lucrări estimate'],
    [
      'now',
      'În lucru acum',
      'Mașinile de pe elevatoare, cu foto, video și live pentru client',
    ],
    ['req', 'Cereri de ofertă', 'Cererile la care nu ai răspuns încă'],
    ['load', 'Încărcarea mecanicilor', 'Câte ore are fiecare mecanic azi'],
    [
      'sched',
      'Programul pe elevatoare',
      'Util doar dacă lucrezi pe elevatoare',
    ],
    ['funnel', 'De la profil la cerere', 'Vizualizări și cereri, pe săptămâni'],
    ['brands', 'Mărci cerute', 'Ce mașini te caută luna asta'],
    ['reviews', 'Recenzii noi', 'Ultimele recenzii, cu buton de răspuns'],
  ])('names %s in Romanian', (key, name, description) => {
    expect(panel('ro').name[key]).toBe(name);
    expect(panel('ro').description[key]).toBe(description);
  });

  it.each([
    [
      'kpi',
      'Today’s numbers',
      'New requests, bookings, rating, estimated work',
    ],
    [
      'now',
      'In work now',
      'Cars on the lifts, with photos, video and live for the customer',
    ],
    ['req', 'Quote requests', 'Requests you haven’t answered yet'],
    ['load', 'Mechanic load', 'Hours booked per mechanic today'],
    ['sched', 'Schedule by lift', 'Only useful if you work on lifts'],
    ['funnel', 'From profile view to request', 'Views and requests, by week'],
    ['brands', 'Brands requested', 'Which cars look for you this month'],
    ['reviews', 'New reviews', 'Latest reviews, with a reply button'],
  ])('names %s in English', (key, name, description) => {
    expect(panel('en').name[key]).toBe(name);
    expect(panel('en').description[key]).toBe(description);
  });

  it('writes Romanian with comma-below ș and ț only', () => {
    const romanian = JSON.stringify(panel('ro'));

    expect(romanian).not.toMatch(/[şţŞŢ]/);
  });

  it('counts and names the button in both languages', () => {
    expect(panel('ro').count).toBe('{x} din {y} secțiuni afișate');
    expect(panel('en').count).toBe('{x} of {y} sections shown');
    expect(panel('ro').button).toBe('Personalizează panoul');
    expect(panel('en').button).toBe('Customise dashboard');
  });
});
