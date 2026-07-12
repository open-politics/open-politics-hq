'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { setNavigate } from '@/lib/commandRegistry'

/**
 * Mount once in the app shell. Captures `router.push` into the command registry
 * so the `navigate` command can run from the non-React singleton. This is the
 * only React glue the registry needs — dock/observe handlers use `getState()`.
 */
export function CommandRegistryBridge() {
  const router = useRouter()
  useEffect(() => {
    setNavigate((to: string) => router.push(to))
    return () => setNavigate(null)
  }, [router])
  return null
}
