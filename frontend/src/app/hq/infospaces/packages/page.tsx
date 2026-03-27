'use client';

import React from 'react';
import PackageManager from '@/components/collection/sharing/PackageManager';

export default function PackagesPage() {
  return (
    <div className="flex h-full w-full max-w-full max-h-[92.75svh] flex-col overflow-hidden min-h-[91svh] md:min-h-[92.75svh]">
      <PackageManager />
    </div>
  );
}
