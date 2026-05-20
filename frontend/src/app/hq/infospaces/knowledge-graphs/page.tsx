'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function KnowledgeGraphsRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const qs = searchParams.toString();
    router.replace(qs ? `/hq/infospaces/graphs?${qs}` : '/hq/infospaces/graphs');
  }, [router, searchParams]);

  return null;
}
