'use client';

import { useSyncExternalStore } from 'react';
import { MoonIcon, SunIcon } from 'lucide-react';
import { useTheme } from 'next-themes';

import { messages } from '@/i18n';
import { Button } from '@/shared/ui/button';

/** Nothing to subscribe to: the value only differs between the server render and the browser. */
function subscribeToNothing(): () => void {
  return () => undefined;
}

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  // The theme is known only in the browser: the server render and the first paint show the same
  // disabled button, then the real one (no state set inside an effect).
  const mounted = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className={className}
        disabled
        aria-label={messages.theme.label}
      >
        <SunIcon className="size-4" />
      </Button>
    );
  }

  const isDark = resolvedTheme === 'dark';

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={className}
      onClick={() => {
        setTheme(isDark ? 'light' : 'dark');
      }}
      aria-label={isDark ? messages.theme.switchToLight : messages.theme.switchToDark}
      title={isDark ? messages.theme.switchToLight : messages.theme.switchToDark}
    >
      {isDark ? (
        <SunIcon className="size-4 transition-transform duration-200" />
      ) : (
        <MoonIcon className="size-4 transition-transform duration-200" />
      )}
    </Button>
  );
}
