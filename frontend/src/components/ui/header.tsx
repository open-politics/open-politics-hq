import React from 'react'
import { ModeToggle } from './mode-toggle'
import { cn } from '@/lib/utils'
import HistoryContainer from '../collection/_unsorted_legacy/desk-history-container'
import Link from 'next/link'

export const Header: React.FC = async () => {
  return (
    <header className="fixed w-full p-1 md:p-2 flex justify-between items-center z-10 backdrop-blur md:backdrop-blur-none bg-background/80 md:bg-transparent">
      <div>
        <Link href="/">
          <span className="sr-only">Morphic</span>
        </Link>
      </div>
      <div className="flex gap-0.5">
        <ModeToggle />
        {/* <HistoryContainer location="header" userId={user?.id} /> */}
      </div>
    </header>
  )
}

export default Header
