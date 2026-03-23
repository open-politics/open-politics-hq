'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function EntitiesPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/hq/infospaces/knowledge-graphs#entities-section');
  }, [router]);

  return null;
}
