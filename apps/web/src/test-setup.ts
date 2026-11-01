import { beforeEach } from 'vitest';
import { setLanguage } from '@/i18n';

// The app's default language is English. Most of these tests were written against the Arabic
// texts, so each starts in Arabic; the tests about English switch language themselves.
beforeEach(() => {
  setLanguage('ar', { persist: false });
});
