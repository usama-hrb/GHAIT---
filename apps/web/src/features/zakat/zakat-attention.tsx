import type { ZakatReviewItem } from '@fabric/contracts';
import Link from 'next/link';
import { messages } from '@/i18n';
import { ReviewItemList } from './review-items';
import { attentionItemsOf, infoItemsOf } from './zakat-model';

const TITLE_ID = 'zakat-attention-title';

/**
 * What the overview asks a person to look at: the items that block the calculation or need review,
 * each with what it is about, and a pointer to the review for the notes that are only good to know.
 * It shows nothing when there is nothing to say. It reads what `zakatReviewOf` found.
 */
export function ZakatAttention({ items }: { items: readonly ZakatReviewItem[] }) {
  const t = messages.zakat.attention;
  const attention = attentionItemsOf(items);
  const notes = infoItemsOf(items);
  if (attention.length === 0 && notes.length === 0) return null;
  return (
    <section aria-labelledby={attention.length > 0 ? TITLE_ID : undefined} className="grid gap-3">
      {attention.length > 0 && (
        <>
          <h2 id={TITLE_ID} className="font-heading text-lg font-semibold">
            {t.title}
          </h2>
          <ReviewItemList items={attention} />
        </>
      )}
      {notes.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {t.notes(notes.length)}{' '}
          <Link
            href="/zakat/review"
            className="font-medium text-foreground underline underline-offset-4"
          >
            {t.openReview}
          </Link>
        </p>
      )}
    </section>
  );
}
