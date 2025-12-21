'use client';

import { ThemeProvider } from "@/components/ui/theme-provider";
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';

function ErrorFallback({error}) {
  return (
    <div role="alert">
      <p>Something went wrong:</p>
      <pre>{error.message}</pre>
    </div>
  )
}

// Resets to system theme whenever OS theme changes
function SystemThemeSync({ children }: { children: React.ReactNode }) {
  const { setTheme } = useTheme();
  
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => setTheme('system');
    
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [setTheme]);
  
  return <>{children}</>;
}

export default function ClientWrapper({ children }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <SystemThemeSync>
            {children}
          </SystemThemeSync>
        </ThemeProvider>
      </QueryClientProvider>
  );
}
