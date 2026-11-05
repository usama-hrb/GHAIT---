import { messages } from '@/i18n';
import { Badge } from '@/shared/ui/badge';

const t = messages.inventory;

export function EstimatedBadge() {
  return <Badge variant="warning">{t.estimated}</Badge>;
}

/** Sold beyond its length (two devices offline, or a short estimate): measure or count it. */
export function ReviewBadge() {
  return <Badge variant="destructive">{t.review}</Badge>;
}
