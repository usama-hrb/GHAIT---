/** The Arabic definite article: it starts many names and says nothing about whose they are. */
const ARTICLE = 'ال';

const letterOf = (word: string): string => {
  const letters = Array.from(word);
  const skip = word.startsWith(ARTICLE) && letters.length > ARTICLE.length ? ARTICLE.length : 0;
  return letters[skip] ?? '';
};

/**
 * The letters on an avatar: the first letter of the first two words of the name, past a leading
 * "ال" ("مورد الحرير" and "مورد القطن" are told apart: م ح, م ق).
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map(letterOf).join('').toLocaleUpperCase();
}
