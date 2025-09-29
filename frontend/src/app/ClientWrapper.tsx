'use client';

import { ThemeProvider } from "@/components/ui/theme-provider";
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { useState } from 'react';

function ErrorFallback({error}) {
  return (
    <div role="alert">
      <p>Something went wrong:</p>
      <pre>{error.message}</pre>
    </div>
  )
}

export default function ClientWrapper({ children }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </QueryClientProvider>
  );
}
