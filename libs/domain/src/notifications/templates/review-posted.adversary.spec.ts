import { render } from '../templates';

const link = 'https://motorfix.test/app/garage/reviews';

// @traces 074-FR-012
describe('the new review message under hostile names', () => {
  it('escapes markup in an author’s name in the e-mail html', () => {
    const email = render('REVIEW_POSTED.job', 'email', 'ro', {
      author: '<b>Andrei</b> & <script>x()</script>',
      car: 'BMW 320d',
      link,
      rating: 5,
      source: 'job',
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('<b>Andrei</b>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('escapes markup in a car’s name in the e-mail html', () => {
    const email = render('REVIEW_POSTED.job', 'email', 'en', {
      author: 'Andrei M.',
      car: '"><img src=x onerror=alert(1)>',
      link,
      rating: 5,
      source: 'job',
    });

    expect(email.html).not.toContain('<img');
  });

  it('keeps Romanian diacritics and emoji whole in the bell line', () => {
    expect(
      render('REVIEW_POSTED.job', 'bell', 'ro', {
        author: 'Ștefan Ț.',
        car: 'Dacia Sandero 🚗',
        link,
        rating: 3,
        source: 'job',
      }),
    ).toBe('Recenzie nouă de 3 de la Ștefan Ț. pentru Dacia Sandero 🚗');
  });

  it('writes the bell line in the profile form even when a car is passed', () => {
    expect(
      render('REVIEW_POSTED.profile', 'bell', 'en', {
        author: 'Elena P.',
        car: 'BMW 320d',
        link,
        rating: 5,
        source: 'profile',
      }),
    ).toBe('New 5-star review from Elena P.');
  });

  it('puts the link in the push and the whatsapp message in both languages', () => {
    for (const language of ['ro', 'en'] as const) {
      const push = render('REVIEW_POSTED.job', 'push', language, {
        author: 'Andrei M.',
        car: 'BMW 320d',
        link,
        rating: 5,
        source: 'job',
      });
      expect(push.link).toBe(link);
    }
  });
});
