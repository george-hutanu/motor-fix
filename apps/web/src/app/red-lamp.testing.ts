// What each voice's red lamp says about the brand, from the copy decks:
// every card that lights it reads the same words.
const SAYS = {
  en: {
    '1': (brand: string) => `Doesn’t take ${brand}`,
    '2': (brand: string) => `Doesn’t work on ${brand}`,
    '3': (brand: string) => `Not compatible: ${brand}`,
    '4': (brand: string) => `Says “pass” on ${brand}`,
    '5': (brand: string) => `Doesn’t work on ${brand}`,
  },
  ro: {
    '1': (brand: string) => `Nu primește ${brand}`,
    '2': (brand: string) => `Nu lucrează pe ${brand}`,
    '3': (brand: string) => `Incompatibil: ${brand}`,
    '4': (brand: string) => `La ${brand} zice „pas”`,
    '5': (brand: string) => `Nu lucrează pe ${brand}`,
  },
};

// One row per voice, language and red stance: a refusal, or no word at all.
export const RED_LAMP = (['ro', 'en'] as const).flatMap((language) =>
  (['1', '2', '3', '4', '5'] as const).flatMap((voice) =>
    (['does_not_take', 'unstated'] as const).map(
      (stance) => [voice, language, stance, SAYS[language][voice]] as const,
    ),
  ),
);
