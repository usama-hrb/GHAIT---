'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { LoadingState } from '@/shared/brand';

/** The PWA starts here (manifest start_url); the shop opens on its home screen. */
export default function HomePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/home');
  }, [router]);
  return <LoadingState variant="spinner" />;
}
