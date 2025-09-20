
'use client'

import { ReactNode } from 'react';
import Footer from '@/components/collection/unsorted/Footer';
import Header from '@/components/collection/unsorted/Header';
import { Announcement } from '@/components/collection/unsorted/announcement';

export default function LandingLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <Header />
      {children}
      <Footer />
    </div>
  );
}