'use client';

import React from 'react';
import SearchInterface from '@/components/collection/search/SearchInterface';

export const maxDuration = 60;

export default function SearchPage() {
  return (
    <div className="container mx-auto py-6">
      <div className="max-w-6xl mx-auto">
        <SearchInterface className="h-[calc(100vh-8rem)]" />
      </div>
    </div>
  );
}
