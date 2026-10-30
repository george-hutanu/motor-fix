import { TEMPLATES } from './registry';
import { render } from '../templates';

const KIND = 'FINAL_PRICE_CORRECTED';
const link = 'https://motorfix.test/app/driver/requests/r-1';
const params = (price: number, garage = 'Garaj Nordic') => ({
  garage,
  link,
  price,
});

// @traces 406-FR-007 406-FR-011
describe('the corrected final price message under hostile values', () => {
  it('writes one bani and the limit as lei', () => {
    expect(render(KIND, 'bell', 'ro', params(1))).toContain('0,01 lei');
    expect(render(KIND, 'bell', 'en', params(100_000_000))).toContain(
      '1,000,000 lei',
    );
  });

  it('escapes a garage name carrying markup in the e-mail', () => {
    const email = render(
      KIND,
      'email',
      'ro',
      params(115_000, '<script>alert(1)</script>'),
    );
    expect(email.html).not.toContain('<script>alert(1)</script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('keeps a placeholder typed into the garage name literal', () => {
    expect(render(KIND, 'bell', 'en', params(115_000, '{price}'))).toBe(
      '{price} corrected the final price: 1,150 lei',
    );
  });

  it('keeps unicode in the garage name in the bell and the push', () => {
    const name = 'Garaj Țiriac & Șoimii 🚗';
    expect(render(KIND, 'bell', 'ro', params(115_000, name))).toContain(name);
    expect(render(KIND, 'push', 'ro', params(115_000, name)).body).toContain(
      name,
    );
  });

  it('gives the WhatsApp template the garage and the price as its two slots', () => {
    expect(TEMPLATES[KIND]?.whatsapp?.ro?.slots).toEqual([
      '{garage}',
      '{price}',
    ]);
    const sent = render(KIND, 'whatsapp', 'ro', params(125_050));
    expect(JSON.stringify(sent)).toContain('1.250,50 lei');
  });
});
