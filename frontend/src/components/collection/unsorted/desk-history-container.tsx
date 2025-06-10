import React from 'react'
import { History } from '../../ui/history'
import HistoryList from '@/components/ui/SearchHistory'

type HistoryContainerProps = {
  location: 'sidebar' | 'header'
  userId: number | undefined
}

const HistoryContainer: React.FC<HistoryContainerProps> = async ({
  location,
  userId
}) => {
  return (
    <div
      className={location === 'header' ? 'block sm:hidden' : 'hidden sm:block'}
    >
      <History location="sidebar">
        <HistoryList userId={userId} />
      </History>
    </div>
  )
}

export default HistoryContainer
