import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import useAuth from '@/hooks/useAuth';
import LottiePlaceholder from '@/components/ui/lottie-placeholder';

const withAuth = (WrappedComponent: React.ComponentType) => {
  return (props: any) => {
    const { isLoggedIn, isLoading, isLoggingOut } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const [isClient, setIsClient] = useState(false);

    useEffect(() => {
      setIsClient(true);
    }, []);

    useEffect(() => {
      if (isClient && !isLoading && !isLoggedIn && !isLoggingOut) {
        if (pathname !== '/accounts/login') {
          router.push('/accounts/login');
        }
      }
    }, [isClient, isLoading, isLoggedIn, isLoggingOut, router, pathname]);

    if (!isClient || isLoading || isLoggingOut) {
      return <LottiePlaceholder />;
    }

    if (!isLoggedIn) {
      return <LottiePlaceholder />;
    }

    return <WrappedComponent {...props} />;
  };
};

export default withAuth;