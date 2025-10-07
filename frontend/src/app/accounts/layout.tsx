'use client'

import Header from "@/components/collection/_unsorted_legacy/Header"

export default function AccountsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen w-full">
      <Header />
      <div className="flex-1">
        {children}
      </div>
    </div>
  )
}