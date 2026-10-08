// A text as searches and duplicate checks read it: accents and case aside.
export const fold = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
