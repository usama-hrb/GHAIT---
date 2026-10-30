'use client';

import { ErrorState } from '@/shared/brand';

/** A screen crashed: say so and let the owner retry (local data is untouched). */
export default function ShopError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState onRetry={reset} />;
}
