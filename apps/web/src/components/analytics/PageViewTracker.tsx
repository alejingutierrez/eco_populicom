'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { trackPageView } from '@/lib/analytics';

/** page_view por cada ruta Next (sign-in, /settings/* abiertos fuera de la SPA). */
export function PageViewTracker() {
  const pathname = usePathname();
  useEffect(() => {
    trackPageView();
  }, [pathname]);
  return null;
}
