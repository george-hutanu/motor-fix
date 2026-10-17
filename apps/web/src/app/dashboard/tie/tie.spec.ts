import { TiePipe } from './tie';

describe('TiePipe', () => {
  const tie = (text: string) => new TiePipe().transform(text);

  it('holds a one- or two-letter word to the word after it', () => {
    expect(tie('Adaugă o mașină')).toBe('Adaugă o mașină');
    expect(tie('Caută un service')).toBe('Caută un service');
    expect(tie('Add a car')).toBe('Add a car');
  });

  it('leaves longer words, a short last word and a short first word alone where nothing follows', () => {
    expect(tie('Caută altele')).toBe('Caută altele');
    expect(tie('Mergi la')).toBe('Mergi la');
    expect(tie('Un')).toBe('Un');
  });

  it('ties a short first word too', () => {
    expect(tie('O mașină nouă')).toBe('O mașină nouă');
  });
});
