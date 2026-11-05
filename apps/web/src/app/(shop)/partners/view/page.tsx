import { RedirectTo } from '@/shared/lib/redirect';

/** /partners/view?id=… moved into Settings (ADR 0017); the partner's id travels with it. */
export default function Page() {
  return <RedirectTo href="/settings/partners/view" keepSearch />;
}
