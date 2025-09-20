'use client'

// No providers needed currently - using custom JWT auth with client-side protection
export function Providers({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
