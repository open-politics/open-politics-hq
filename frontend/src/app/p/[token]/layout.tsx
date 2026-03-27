import React from 'react';

export default function PackageConsumerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-3 flex items-center gap-2">
        <span className="font-semibold text-sm">Open Politics HQ</span>
        <span className="text-xs text-muted-foreground">Shared Package</span>
      </header>
      <main className="max-w-4xl mx-auto p-6">
        {children}
      </main>
    </div>
  );
}
