import { describe, expect, it } from 'vitest';
import { LANGUAGES, messages, setLanguage } from '@/i18n';
import { markup, occurrences, textOf } from '@/shared/testing/static-markup';
import { NotFoundScreen } from './not-found-screen';

describe('the page for an address that matches no screen', () => {
  it('says what happened in its one heading, in each language', () => {
    for (const language of LANGUAGES) {
      setLanguage(language, { persist: false });
      const html = markup(<NotFoundScreen />);
      expect(occurrences(html, '<h1')).toBe(1);
      expect(html).toContain(`>${messages.notFound.title}</h1>`);
      expect(textOf(html)).toContain(messages.notFound.description);
    }
  });

  it('leads out through one gold action, to the home screen', () => {
    setLanguage('en', { persist: false });
    const html = markup(<NotFoundScreen />);
    expect(occurrences(html, 'data-variant="accent"')).toBe(1);
    expect(html).toMatch(/<a [^>]*data-variant="accent"[^>]*href="\/home"[^>]*>Back to home<\/a>/);
  });

  it('keeps the big code out of the reading order, since the heading already says it', () => {
    setLanguage('en', { persist: false });
    const html = markup(<NotFoundScreen />);
    expect(html).toMatch(/<p aria-hidden="true"[^>]*dir="ltr"[^>]*>404<\/p>/);
  });

  it('lets the visitor change the language and the theme, as the sign-in page does', () => {
    setLanguage('en', { persist: false });
    const html = markup(<NotFoundScreen />);
    expect(html).toContain('aria-label="Switch to Arabic"');
    expect(html).toContain(`aria-label="${messages.theme.label}"`);
  });

  it('has its texts in both catalogs, and no Arabic letter in the English ones', () => {
    for (const key of ['code', 'title', 'description', 'backToHome'] as const) {
      setLanguage('en', { persist: false });
      const english = messages.notFound[key];
      setLanguage('ar', { persist: false });
      const arabic = messages.notFound[key];
      expect(english.length, key).toBeGreaterThan(0);
      expect(arabic.length, key).toBeGreaterThan(0);
      expect(english, key).not.toMatch(/\p{Script=Arabic}/u);
    }
    setLanguage('en', { persist: false });
  });
});
