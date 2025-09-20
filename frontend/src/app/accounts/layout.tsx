'use client'

import Header from "@/components/collection/unsorted/Header"

export default function AccountsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <Header />
      {children}
    </div>
  )
}