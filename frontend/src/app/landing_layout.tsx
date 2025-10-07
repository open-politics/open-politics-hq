
'use client'

import { ReactNode } from 'react';
import Footer from '@/components/collection/_unsorted_legacy/Footer';
import Header from '@/components/collection/_unsorted_legacy/Header';
import { Announcement } from '@/components/collection/_unsorted_legacy/announcement';

export default function LandingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen w-full">
      <Header />
      {children}
      <Footer />
    </div>
  );
}