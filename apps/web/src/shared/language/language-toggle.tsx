'use client';

import { LanguagesIcon } from 'lucide-react';
import { useLanguage } from './language-provider';
import { Button } from '@/shared/ui/button';

export function LanguageToggle({ className }: { className?: string }) {
  const { language, setLanguage } = useLanguage();

  const isArabic = language === 'ar';

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={className}
      onClick={() => setLanguage(isArabic ? 'en' : 'ar')}
      aria-label={`Switch to ${isArabic ? 'English' : 'Arabic'}`}
      title={`Switch to ${isArabic ? 'English' : 'Arabic'}`}
    >
      <LanguagesIcon className="size-4" />
      <span className="text-xs font-semibold tracking-wide">{isArabic ? 'en' : 'ع'}</span>
    </Button>
  );
}
