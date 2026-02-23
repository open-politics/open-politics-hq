'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function EnrichmentPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/hq/infospaces/infospace-manager#enrichment-section');
  }, [router]);

  return null;
}
