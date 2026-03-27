'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import PackageConsumerView from '@/components/collection/sharing/PackageConsumerView';

export default function PackageAccessPage() {
  const params = useParams();
  const token = params.token as string;

  if (!token) {
    return <div className="text-sm text-muted-foreground">Invalid package link.</div>;
  }

  return <PackageConsumerView token={token} />;
}
