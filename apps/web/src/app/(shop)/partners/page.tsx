import { RedirectTo } from '@/shared/lib/redirect';

/**
 * Moved into Settings (ADR 0017). Kept so old links and bookmarks land there (the page redirects
 * on the client, so the service worker's copy of it works offline too).
 */
export default function Page() {
  return <RedirectTo href="/settings/partners" />;
}
