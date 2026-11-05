import { RedirectTo } from '@/shared/lib/redirect';

/**
 * Gone since ADR 0012: stock is managed in the Inventory, by product. Kept so old links and
 * bookmarks land there (the page redirects on the client, so the
 * service worker's copy of it works offline too).
 */
export default function Page() {
  return <RedirectTo href="/inventory" />;
}
