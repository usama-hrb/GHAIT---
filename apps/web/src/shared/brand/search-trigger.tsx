'use client';

import { SearchIcon } from 'lucide-react';
import { useEffect } from 'react';
import { messages } from '@/i18n';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';

/** Opens quick search; also bound to Ctrl+K / ⌘K. */
export function SearchTrigger({
  onSearch,
  className,
}: {
  onSearch: () => void;
  className?: string;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onSearch();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onSearch]);

  return (
    <Button
      variant="outline"
      onClick={onSearch}
      aria-keyshortcuts="Control+K Meta+K"
      className={cn('gap-2 text-muted-foreground md:w-56 md:justify-start', className)}
    >
      <SearchIcon aria-hidden />
      {/* Visible from md; on phones the icon button keeps it as its accessible name. */}
      <span className="sr-only md:not-sr-only">{messages.shell.search}</span>
      <kbd
        aria-hidden
        dir="ltr"
        className="ms-auto hidden rounded border bg-muted px-1.5 font-mono text-[0.7rem] md:inline"
      >
        Ctrl K
      </kbd>
    </Button>
  );
}
