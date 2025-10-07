'use client'

import { useEffect, useState } from 'react'

const BackgroundImage = () => {
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  if (!isMounted) return null

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[0] pointer-events-none"
      style={{
        backgroundImage: 'url(/images/background.jpg)',
        backgroundRepeat: 'no-repeat',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    />
  )
}

export default BackgroundImage


