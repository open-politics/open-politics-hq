'use client'

import React, { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import useAuth from '@/hooks/useAuth';
import LottiePlaceholder from '@/components/ui/lottie-placeholder';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isLoggedIn, isLoggingOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (isClient && !isLoading && (!isLoggedIn || !user?.is_superuser)) {
      console.log('Admin access denied - Redirecting to home:', {
        notLoggedIn: !isLoggedIn,
        notSuperuser: !user?.is_superuser,
      });
      if (pathname !== '/') {
        router.push('/');
      }
    }
  }, [isClient, isLoading, isLoggedIn, user, router, pathname]);

  if (!isClient || isLoading || isLoggingOut) {
    return <LottiePlaceholder />;
  }

  if (!isLoggedIn || !user?.is_superuser) {
    return <LottiePlaceholder />;
  }

  return (
    <div className="admin-layout">
      <main className="mt-16">{children}</main>
    </div>
  );
}